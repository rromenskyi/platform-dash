import type { PageServerLoad } from './$types';
import { canRead, requireRead } from '$lib/authz';
import { listClusters } from '$lib/clusters.server';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type FailingPod = {
	cluster: string;
	namespace: string;
	name: string;
	phase: string;
	restarts: number;
	reason?: string;
	exitCode?: number;
	containerWaiting?: string;
	startedAt?: string;
};

export type WarningEvent = {
	cluster: string;
	namespace: string;
	involved: string;
	reason: string;
	message: string;
	count: number;
	lastSeen?: string;
};

export type BadNode = {
	cluster: string;
	name: string;
	condition: string;
	status: string;
	reason?: string;
};

export type ClusterReport = {
	cluster: string;
	reachable: boolean;
	error?: string;
	failingPods: FailingPod[];
	warningEvents: WarningEvent[];
	badNodes: BadNode[];
	totals: { pods: number; nodes: number; events: number };
};

// Snapshot every cluster the user can read. Per-cluster failures are
// caught so one bad cluster doesn't take the whole page down — that
// cluster's card just shows the error inline. Each cluster runs its
// three list calls in parallel; clusters fan out in parallel too.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);

	const clusters = listClusters().filter((c) => canRead(session, c));

	const reports: ClusterReport[] = await Promise.all(
		clusters.map(async (cluster): Promise<ClusterReport> => {
			try {
				const [pods, nodes, events] = await Promise.all([
					time(`${cluster}/listPodForAllNamespaces`, () =>
						core(cluster).listPodForAllNamespaces()
					),
					time(`${cluster}/listNode`, () => core(cluster).listNode()),
					time(`${cluster}/listEventForAllNamespaces`, () =>
						core(cluster).listEventForAllNamespaces()
					)
				]);

				const failingPods: FailingPod[] = [];
				for (const p of pods.items) {
					const containers = p.status?.containerStatuses ?? [];
					const restarts = containers.reduce((acc, c) => acc + (c.restartCount ?? 0), 0);
					const phase = p.status?.phase ?? '?';
					const waiting = containers.find((c) => c.state?.waiting)?.state?.waiting?.reason;
					const lastTerm = containers.find((c) => c.lastState?.terminated)?.lastState?.terminated;
					const isUnhappy =
						phase === 'Failed' ||
						phase === 'Unknown' ||
						(phase === 'Pending' && !!waiting) ||
						(phase === 'Running' && containers.some((c) => !c.ready)) ||
						restarts >= 3;
					if (!isUnhappy) continue;
					failingPods.push({
						cluster,
						namespace: p.metadata?.namespace ?? '?',
						name: p.metadata?.name ?? '?',
						phase,
						restarts,
						reason: lastTerm?.reason ?? waiting,
						exitCode: lastTerm?.exitCode,
						containerWaiting: waiting,
						startedAt: p.status?.startTime
							? new Date(p.status.startTime).toISOString()
							: undefined
					});
				}
				// Worst first: by restarts desc, then name
				failingPods.sort((a, b) => b.restarts - a.restarts || a.name.localeCompare(b.name));

				const badNodes: BadNode[] = [];
				let nodeReadyCount = 0;
				for (const n of nodes.items) {
					const conds = n.status?.conditions ?? [];
					const ready = conds.find((c) => c.type === 'Ready');
					if (ready?.status === 'True') nodeReadyCount++;
					if (ready && ready.status !== 'True') {
						badNodes.push({
							cluster,
							name: n.metadata?.name ?? '?',
							condition: 'Ready',
							status: ready.status ?? '?',
							reason: ready.reason
						});
					}
					for (const c of conds) {
						if (
							c.status === 'True' &&
							(c.type === 'MemoryPressure' || c.type === 'DiskPressure' || c.type === 'PIDPressure' || c.type === 'NetworkUnavailable')
						) {
							badNodes.push({
								cluster,
								name: n.metadata?.name ?? '?',
								condition: c.type,
								status: 'True',
								reason: c.reason
							});
						}
					}
				}

				const warnRaw = events.items
					.filter((e) => e.type === 'Warning')
					.map((e) => ({
						cluster,
						namespace: e.metadata?.namespace ?? e.involvedObject?.namespace ?? '?',
						involved: `${e.involvedObject?.kind ?? '?'}/${e.involvedObject?.name ?? '?'}`,
						reason: e.reason ?? '?',
						message: e.message ?? '',
						count: e.count ?? 1,
						lastSeen: e.lastTimestamp
							? new Date(e.lastTimestamp).toISOString()
							: e.eventTime
								? new Date(e.eventTime).toISOString()
								: undefined
					}));
				warnRaw.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
				const warningEvents = warnRaw.slice(0, 30);

				return {
					cluster,
					reachable: true,
					failingPods: failingPods.slice(0, 20),
					warningEvents,
					badNodes,
					totals: { pods: pods.items.length, nodes: nodes.items.length, events: events.items.length }
				};
			} catch (err) {
				return {
					cluster,
					reachable: false,
					error: err instanceof Error ? err.message : String(err),
					failingPods: [],
					warningEvents: [],
					badNodes: [],
					totals: { pods: 0, nodes: 0, events: 0 }
				};
			}
		})
	);

	const totals = reports.reduce(
		(acc, r) => ({
			pods: acc.pods + r.failingPods.length,
			nodes: acc.nodes + r.badNodes.length,
			events: acc.events + r.warningEvents.length
		}),
		{ pods: 0, nodes: 0, events: 0 }
	);

	return { reports, totals, snapshotAt: new Date().toISOString() };
};
