import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, apps, apiextensions, metrics } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';
import { parseCpuMilli, parseMemBytes } from '$lib/quantity';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

	const cluster = event.params.cluster;

	// Cluster summary — pulled once per request, cached implicitly by
	// SvelteKit's data-loading. Cheap reads (counts only).
	let summary: {
		// null for namespace-scoped users: nodes and CRD definitions are
		// cluster-scoped and not theirs to see.
		nodes: { ready: number; total: number } | null;
		namespaces: number;
		pods: { running: number; pending: number; failed: number; total: number };
		deployments: { ready: number; total: number };
		crds: number | null;
	};
	const clusterWide = accessibleNamespaces(session, cluster) === 'all';

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
			nodes: clusterWide ? { ready: nodesReady, total: nodes.length } : null,
			namespaces: visibleNamespaces,
			pods: {
				running: phaseCount('Running'),
				pending: phaseCount('Pending'),
				failed: phaseCount('Failed'),
				total: pods.length
			},
			deployments: { ready: depsReady, total: deps.length },
			crds: clusterWide ? crdsRes.items.length : null
		};
	} catch (err) {
		// Surface the failure to the page rather than 500 — RBAC
		// misconfiguration or APIServer hiccup shouldn't kill the
		// whole dash; cards still render with `—`.
		console.error('k8s overview load failed', err);
		summary = {
			nodes: clusterWide ? { ready: 0, total: 0 } : null,
			namespaces: 0,
			pods: { running: 0, pending: 0, failed: 0, total: 0 },
			deployments: { ready: 0, total: 0 },
			crds: clusterWide ? 0 : null
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

	return { session, summary, cluster, topPods, metricsAvailable, clusterWide };
};

