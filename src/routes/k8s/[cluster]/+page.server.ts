import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, apps, apiextensions, metrics } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

	const cluster = event.params.cluster;

	// Cluster summary — pulled once per request, cached implicitly by
	// SvelteKit's data-loading. Cheap reads (counts only).
	let summary: {
		nodes: { ready: number; total: number };
		namespaces: number;
		pods: { running: number; pending: number; failed: number; total: number };
		deployments: { ready: number; total: number };
		crds: number;
	};

	try {
		const [nodesRes, nsRes, podsRes, depsRes, crdsRes] = await Promise.all([
			time(`${cluster}/listNode`, () => core(cluster).listNode()),
			time(`${cluster}/listNamespace`, () => core(cluster).listNamespace()),
			time(`${cluster}/listPodForAllNamespaces`, () => core(cluster).listPodForAllNamespaces()),
			time(`${cluster}/listDeploymentForAllNamespaces`, () =>
				apps(cluster).listDeploymentForAllNamespaces()
			),
			time(`${cluster}/listCustomResourceDefinition`, () =>
				apiextensions(cluster).listCustomResourceDefinition()
			)
				// CRDs are non-critical for the overview — if RBAC is missing
				// or the apiextensions group is unreachable, fall through to
				// `crds: 0` instead of blanking the whole page.
				.catch((err) => {
					console.warn('list crds failed (overview)', err);
					return { items: [] as unknown[] };
				})
		]);

		const accessible = accessibleNamespaces(session, cluster);
		const inScope = (ns: string | undefined): boolean => {
			if (!ns) return false;
			if (accessible === 'all') return true;
			return accessible.includes(ns);
		};

		const nodes = nodesRes.items;
		const nodesReady = nodes.filter((n) =>
			n.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
		).length;

		const pods =
			accessible === 'all'
				? podsRes.items
				: podsRes.items.filter((p) => inScope(p.metadata?.namespace));
		const phaseCount = (phase: string) => pods.filter((p) => p.status?.phase === phase).length;

		const deps =
			accessible === 'all'
				? depsRes.items
				: depsRes.items.filter((d) => inScope(d.metadata?.namespace));
		const depsReady = deps.filter(
			(d) => (d.status?.readyReplicas ?? 0) === (d.spec?.replicas ?? 0)
		).length;

		const visibleNamespaces =
			accessible === 'all'
				? nsRes.items.length
				: nsRes.items.filter((n) => accessible.includes(n.metadata?.name ?? '')).length;

		summary = {
			nodes: { ready: nodesReady, total: nodes.length },
			namespaces: visibleNamespaces,
			pods: {
				running: phaseCount('Running'),
				pending: phaseCount('Pending'),
				failed: phaseCount('Failed'),
				total: pods.length
			},
			deployments: { ready: depsReady, total: deps.length },
			// CRD definitions are cluster-scoped — show the count to
			// cluster-wide readers; ns-only operators see 0 because
			// they can't act on CRDs at the definition level anyway.
			crds: accessible === 'all' ? crdsRes.items.length : 0
		};
	} catch (err) {
		// Surface the failure to the page rather than 500 — RBAC
		// misconfiguration or APIServer hiccup shouldn't kill the
		// whole dash; cards still render with `—`.
		console.error('k8s overview load failed', err);
		summary = {
			nodes: { ready: 0, total: 0 },
			namespaces: 0,
			pods: { running: 0, pending: 0, failed: 0, total: 0 },
			deployments: { ready: 0, total: 0 },
			crds: 0
		};
	}

	// Top consumers — best-effort metrics-server snapshot. Optional;
	// clusters without metrics-server installed return 404 and the
	// section just renders empty in the UI.
	let topPods: Array<{ namespace: string; name: string; cpuMilli: number; memBytes: number }> = [];
	let metricsAvailable = true;
	try {
		const ml = await time(`${cluster}/getPodMetricsAll`, () =>
			metrics(cluster).getPodMetrics()
		);
		const accessible = accessibleNamespaces(session, cluster);
		const items =
			accessible === 'all'
				? ml.items
				: ml.items.filter((it) => accessible.includes(it.metadata.namespace ?? ''));
		const rows = items.map((it) => {
			let cpuMilli = 0;
			let memBytes = 0;
			for (const c of it.containers) {
				cpuMilli += parseCpuMilli(c.usage.cpu);
				memBytes += parseMemBytes(c.usage.memory);
			}
			return {
				namespace: it.metadata.namespace ?? '?',
				name: it.metadata.name ?? '?',
				cpuMilli,
				memBytes
			};
		});
		topPods = rows;
	} catch {
		metricsAvailable = false;
	}

	return { session, summary, cluster, topPods, metricsAvailable };
};

// Local CPU / memory parsers — same shape as the nodes page but
// lifted here so the overview page doesn't need to import nodes/+page
// internals. metrics-server emits CPU as nanocores ("139403626n") for
// usage and memory in Ki/Mi/Gi.
function parseCpuMilli(v: string | undefined): number {
	if (!v) return 0;
	if (v.endsWith('n')) return parseFloat(v) / 1_000_000;
	if (v.endsWith('u') || v.endsWith('µ')) return parseFloat(v) / 1_000;
	if (v.endsWith('m')) return parseFloat(v);
	const n = parseFloat(v);
	return Number.isFinite(n) ? n * 1000 : 0;
}

const MEM_UNITS: Record<string, number> = {
	Ki: 1024,
	Mi: 1024 ** 2,
	Gi: 1024 ** 3,
	Ti: 1024 ** 4,
	K: 1000,
	M: 1000 ** 2,
	G: 1000 ** 3,
	T: 1000 ** 4
};
function parseMemBytes(v: string | undefined): number {
	if (!v) return 0;
	const m = /^([\d.]+)([a-zA-Z]*)$/.exec(v);
	if (!m) return 0;
	const num = parseFloat(m[1]);
	if (!Number.isFinite(num)) return 0;
	const mult = m[2] ? (MEM_UNITS[m[2]] ?? 1) : 1;
	return num * mult;
}
