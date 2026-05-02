// Cluster-stuck-state summary for the topbar pill. Caches a count of
// failing pods + bad nodes per cluster with a short TTL so every
// layout load doesn't re-list pods cluster-wide.
//
// The /incident page does its own (richer) snapshot — this is the
// "is anything wrong, at a glance" version that fits in a header
// badge. Same heuristics used there:
//   - Pod is failing if phase Failed/Unknown, or Pending with waiting
//     reason, or Running with un-ready containers, or restarts >= 3.
//   - Node is bad if Ready != True, or any pressure condition True.

import { core } from './k8s.server';
import { listClusters } from './clusters.server';
import { time } from './k8s-metrics.server';

const TTL_MS = 30_000;

export type IncidentSummary = {
	totalFailing: number;
	totalBadNodes: number;
	perCluster: Array<{ cluster: string; failing: number; badNodes: number; reachable: boolean }>;
	at: number;
};

let cached: IncidentSummary | null = null;
let inFlight: Promise<IncidentSummary> | null = null;

async function compute(allowed: string[]): Promise<IncidentSummary> {
	const perCluster: IncidentSummary['perCluster'] = await Promise.all(
		allowed.map(async (cluster) => {
			try {
				const [pods, nodes] = await Promise.all([
					time(`${cluster}/listPodForAllNamespaces`, () =>
						core(cluster).listPodForAllNamespaces()
					),
					time(`${cluster}/listNode`, () => core(cluster).listNode())
				]);
				let failing = 0;
				for (const p of pods.items) {
					const containers = p.status?.containerStatuses ?? [];
					const restarts = containers.reduce((acc, c) => acc + (c.restartCount ?? 0), 0);
					const phase = p.status?.phase ?? '?';
					const waiting = containers.find((c) => c.state?.waiting)?.state?.waiting?.reason;
					const isUnhappy =
						phase === 'Failed' ||
						phase === 'Unknown' ||
						(phase === 'Pending' && !!waiting) ||
						(phase === 'Running' && containers.some((c) => !c.ready)) ||
						restarts >= 3;
					if (isUnhappy) failing++;
				}
				let badNodes = 0;
				for (const n of nodes.items) {
					const conds = n.status?.conditions ?? [];
					const ready = conds.find((c) => c.type === 'Ready');
					if (ready && ready.status !== 'True') badNodes++;
					for (const c of conds) {
						if (
							c.status === 'True' &&
							(c.type === 'MemoryPressure' ||
								c.type === 'DiskPressure' ||
								c.type === 'PIDPressure' ||
								c.type === 'NetworkUnavailable')
						) {
							badNodes++;
							break;
						}
					}
				}
				return { cluster, failing, badNodes, reachable: true };
			} catch {
				return { cluster, failing: 0, badNodes: 0, reachable: false };
			}
		})
	);
	return {
		totalFailing: perCluster.reduce((a, c) => a + c.failing, 0),
		totalBadNodes: perCluster.reduce((a, c) => a + c.badNodes, 0),
		perCluster,
		at: Date.now()
	};
}

export async function incidentSummary(
	canReadCluster: (cluster: string) => boolean
): Promise<IncidentSummary> {
	if (cached && Date.now() - cached.at < TTL_MS) {
		return filterAllowed(cached, canReadCluster);
	}
	if (inFlight) return filterAllowed(await inFlight, canReadCluster);
	const allowed = listClusters().filter(canReadCluster);
	inFlight = compute(allowed)
		.then((s) => {
			cached = s;
			return s;
		})
		.finally(() => {
			inFlight = null;
		});
	return filterAllowed(await inFlight, canReadCluster);
}

function filterAllowed(
	s: IncidentSummary,
	canReadCluster: (cluster: string) => boolean
): IncidentSummary {
	// User's role set may be narrower than the cache's; trim.
	const perCluster = s.perCluster.filter((c) => canReadCluster(c.cluster));
	return {
		totalFailing: perCluster.reduce((a, c) => a + c.failing, 0),
		totalBadNodes: perCluster.reduce((a, c) => a + c.badNodes, 0),
		perCluster,
		at: s.at
	};
}
