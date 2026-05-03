import type { PageServerLoad } from './$types';
import {
	canRead,
	requireRead,
	hasAnyNamespaceRole,
	accessibleNamespaces
} from '$lib/authz';
import { redirect } from '@sveltejs/kit';
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

export type OomPod = {
	cluster: string;
	namespace: string;
	name: string;
	container: string;
	exitCode?: number;
	restarts: number;
	finishedAt?: string;
	startedAt?: string;
	memoryLimit?: string;
};

export type ClusterReport = {
	cluster: string;
	reachable: boolean;
	error?: string;
	failingPods: FailingPod[];
	warningEvents: WarningEvent[];
	badNodes: BadNode[];
	oomKilled: OomPod[];
	totals: { pods: number; nodes: number; events: number; oom: number };
};

// "Recent" window for OOM surfacing — anything older than this gets
// dropped from the panel (the operator can still see it on the pod
// detail page). 24h matches the typical incident-review timeframe.
const OOM_WINDOW_MS = 24 * 60 * 60 * 1000;

// Snapshot every cluster the user can read. Per-cluster failures are
// caught so one bad cluster doesn't take the whole page down — that
// cluster's card just shows the error inline. Each cluster runs its
// three list calls in parallel; clusters fan out in parallel too.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) throw redirect(303, '/');
	// Allow operators with only namespace-scoped roles — the page
	// filters per-cluster sections to their accessible namespaces.
	if (!canRead(session) && !listClusters().some((c) => canRead(session, c)) && !hasAnyNamespaceRole(session)) {
		requireRead(session);
	}

	const clusters = listClusters().filter(
		(c) => canRead(session, c) || hasAnyNamespaceRole(session)
	);

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

				const accessible = accessibleNamespaces(session, cluster);
				const inScope = (ns: string | undefined): boolean => {
					if (!ns) return false;
					if (accessible === 'all') return true;
					return accessible.includes(ns);
				};

				const failingPods: FailingPod[] = [];
				const oomKilled: OomPod[] = [];
				const cutoff = Date.now() - OOM_WINDOW_MS;
				for (const p of pods.items) {
					if (!inScope(p.metadata?.namespace)) continue;
					const containers = p.status?.containerStatuses ?? [];
					const restarts = containers.reduce((acc, c) => acc + (c.restartCount ?? 0), 0);
					const phase = p.status?.phase ?? '?';
					const waiting = containers.find((c) => c.state?.waiting)?.state?.waiting?.reason;
					const lastTerm = containers.find((c) => c.lastState?.terminated)?.lastState?.terminated;
					// Succeeded = Job/CronJob pod that finished cleanly. Never an
					// incident, even if it accumulated restarts on the way to
					// success (restartPolicy: OnFailure).
					const isUnhappy =
						phase !== 'Succeeded' &&
						(phase === 'Failed' ||
							phase === 'Unknown' ||
							(phase === 'Pending' && !!waiting) ||
							(phase === 'Running' && containers.some((c) => !c.ready)) ||
							restarts >= 3);
					if (isUnhappy) {
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
					// OOM surface — independent of "is this pod unhappy
					// right now". A pod that OOM'd two hours ago and
					// recovered should still show up here.
					for (const c of containers) {
						const t = c.lastState?.terminated;
						if (t?.reason !== 'OOMKilled') continue;
						const fin = t.finishedAt ? new Date(t.finishedAt).getTime() : 0;
						if (fin && fin < cutoff) continue;
						const limits =
							p.spec?.containers?.find((sc) => sc.name === c.name)?.resources?.limits ?? {};
						oomKilled.push({
							cluster,
							namespace: p.metadata?.namespace ?? '?',
							name: p.metadata?.name ?? '?',
							container: c.name,
							exitCode: t.exitCode,
							restarts: c.restartCount ?? 0,
							finishedAt: t.finishedAt ? new Date(t.finishedAt).toISOString() : undefined,
							startedAt: t.startedAt ? new Date(t.startedAt).toISOString() : undefined,
							memoryLimit: (limits as Record<string, string>).memory
						});
					}
				}
				// Worst first: by restarts desc, then name
				failingPods.sort((a, b) => b.restarts - a.restarts || a.name.localeCompare(b.name));
				// Most recent OOM first.
				oomKilled.sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));

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
					.filter((e) =>
						inScope(e.metadata?.namespace ?? e.involvedObject?.namespace)
					)
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
					oomKilled: oomKilled.slice(0, 20),
					totals: {
						pods: pods.items.length,
						nodes: nodes.items.length,
						events: events.items.length,
						oom: oomKilled.length
					}
				};
			} catch (err) {
				return {
					cluster,
					reachable: false,
					error: err instanceof Error ? err.message : String(err),
					failingPods: [],
					warningEvents: [],
					badNodes: [],
					oomKilled: [],
					totals: { pods: 0, nodes: 0, events: 0, oom: 0 }
				};
			}
		})
	);

	const totals = reports.reduce(
		(acc, r) => ({
			pods: acc.pods + r.failingPods.length,
			nodes: acc.nodes + r.badNodes.length,
			events: acc.events + r.warningEvents.length,
			oom: acc.oom + r.oomKilled.length
		}),
		{ pods: 0, nodes: 0, events: 0, oom: 0 }
	);

	return { reports, totals, snapshotAt: new Date().toISOString() };
};
