import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, apps, apiextensions } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

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
			time('listNode', () => core().listNode()),
			time('listNamespace', () => core().listNamespace()),
			time('listPodForAllNamespaces', () => core().listPodForAllNamespaces()),
			time('listDeploymentForAllNamespaces', () => apps().listDeploymentForAllNamespaces()),
			time('listCustomResourceDefinition', () => apiextensions().listCustomResourceDefinition())
				// CRDs are non-critical for the overview — if RBAC is missing
				// or the apiextensions group is unreachable, fall through to
				// `crds: 0` instead of blanking the whole page.
				.catch((err) => {
					console.warn('list crds failed (overview)', err);
					return { items: [] as unknown[] };
				})
		]);

		const nodes = nodesRes.items;
		const nodesReady = nodes.filter((n) =>
			n.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
		).length;

		const pods = podsRes.items;
		const phaseCount = (phase: string) => pods.filter((p) => p.status?.phase === phase).length;

		const deps = depsRes.items;
		const depsReady = deps.filter(
			(d) => (d.status?.readyReplicas ?? 0) === (d.spec?.replicas ?? 0)
		).length;

		summary = {
			nodes: { ready: nodesReady, total: nodes.length },
			namespaces: nsRes.items.length,
			pods: {
				running: phaseCount('Running'),
				pending: phaseCount('Pending'),
				failed: phaseCount('Failed'),
				total: pods.length
			},
			deployments: { ready: depsReady, total: deps.length },
			crds: crdsRes.items.length
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

	return { session, summary };
};
