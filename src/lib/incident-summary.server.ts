// Cluster-stuck-state summary for the topbar pill. Caches a count of
// failing pods + bad nodes per cluster with a short TTL so every
// layout load doesn't re-list pods cluster-wide.
//
// Stale-while-revalidate: callers ALWAYS get the cached value back
// (or null on cold cache) without ever awaiting a fresh k8s call.
// When the cache is expired (or empty), a background refresh kicks
// off. This guarantees the layout — which calls us on every nav —
// never blocks, even if the apiserver is unreachable or slow.
//
// The /incident page does its own (richer, awaited) snapshot — this
// is the "is anything wrong, at a glance" version that fits in a
// header badge. Same heuristics:
//   - Pod is failing if phase Failed/Unknown, or Pending with waiting
//     reason, or Running with un-ready containers, or restarts >= 3.
//   - Node is bad if Ready != True, or any pressure condition True.

import { core } from './k8s.server';
import { listClusters } from './clusters.server';
import { time } from './k8s-metrics.server';
import { isPodFailing } from './pod-health';

const TTL_MS = 30_000;
// Per-cluster k8s call timeout. If the apiserver hangs, the whole
// summary used to wait forever; cap each branch so the worst case
// is "this cluster looks unreachable for a tick".
const CLUSTER_TIMEOUT_MS = 5_000;

export type IncidentSummary = {
	totalFailing: number;
	totalBadNodes: number;
	perCluster: Array<{ cluster: string; failing: number; badNodes: number; reachable: boolean }>;
	at: number;
};

let cached: IncidentSummary | null = null;
let inFlight: Promise<IncidentSummary> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			}
		);
	});
}

async function compute(allowed: string[]): Promise<IncidentSummary> {
	const perCluster: IncidentSummary['perCluster'] = await Promise.all(
		allowed.map(async (cluster) => {
			try {
				const [pods, nodes] = await Promise.all([
					withTimeout(
						time(`${cluster}/listPodForAllNamespaces`, () =>
							core(cluster).listPodForAllNamespaces()
						),
						CLUSTER_TIMEOUT_MS,
						`${cluster}/listPodForAllNamespaces`
					),
					withTimeout(
						time(`${cluster}/listNode`, () => core(cluster).listNode()),
						CLUSTER_TIMEOUT_MS,
						`${cluster}/listNode`
					)
				]);
				let failing = 0;
				for (const p of pods.items) {
					if (isPodFailing(p)) failing++;
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

function kickRefresh(canReadCluster: (cluster: string) => boolean) {
	if (inFlight) return;
	const allowed = listClusters().filter(canReadCluster);
	inFlight = compute(allowed)
		.then((s) => {
			cached = s;
			return s;
		})
		.catch(() => {
			// On total failure keep whatever we had; never poison the
			// cache with a degraded snapshot.
			return (
				cached ?? {
					totalFailing: 0,
					totalBadNodes: 0,
					perCluster: [],
					at: Date.now()
				}
			);
		})
		.finally(() => {
			inFlight = null;
		});
}

// SYNC: returns the cached value immediately (or null on cold start);
// kicks a background refresh when expired or empty. Callers must
// handle null. The layout has done so since it shipped.
export function incidentSummary(
	canReadCluster: (cluster: string) => boolean
): IncidentSummary | null {
	const fresh = cached && Date.now() - cached.at < TTL_MS;
	if (!fresh) kickRefresh(canReadCluster);
	if (!cached) return null;
	return filterAllowed(cached, canReadCluster);
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
