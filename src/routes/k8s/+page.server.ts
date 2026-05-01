import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canRead } from '$lib/authz';
import { core } from '$lib/k8s.server';
import { listClusters, defaultCluster } from '$lib/clusters.server';
import { time } from '$lib/k8s-metrics.server';

export type ClusterRollup = {
	name: string;
	reachable: boolean;
	error?: string;
	nodes?: { ready: number; total: number };
	pods?: { running: number; pending: number; failed: number; total: number };
	namespaces?: number;
	canRead: boolean;
};

// Multi-cluster overview. When only one cluster is configured we
// keep the legacy behaviour and bounce straight to it — the rollup
// adds nothing in that case. Two or more clusters: render the cards
// page so the operator picks where to dive in.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const clusters = listClusters();

	if (clusters.length === 1) {
		const target = `/k8s/${clusters[0]}${event.url.search}`;
		throw redirect(303, target);
	}

	const rollups: ClusterRollup[] = await Promise.all(
		clusters.map(async (name): Promise<ClusterRollup> => {
			const reader = canRead(session, name);
			if (!reader) return { name, reachable: false, error: 'no read role on this cluster', canRead: false };
			try {
				const [nodes, pods, ns] = await Promise.all([
					time(`${name}/listNode`, () => core(name).listNode()),
					time(`${name}/listPodForAllNamespaces`, () => core(name).listPodForAllNamespaces()),
					time(`${name}/listNamespace`, () => core(name).listNamespace())
				]);
				const ready = nodes.items.filter((n) =>
					n.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
				).length;
				const phase = (p: string) => pods.items.filter((x) => x.status?.phase === p).length;
				return {
					name,
					reachable: true,
					canRead: true,
					nodes: { ready, total: nodes.items.length },
					pods: {
						running: phase('Running'),
						pending: phase('Pending'),
						failed: phase('Failed'),
						total: pods.items.length
					},
					namespaces: ns.items.length
				};
			} catch (err) {
				return {
					name,
					reachable: false,
					canRead: true,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		})
	);

	return { rollups, defaultCluster: defaultCluster() };
};
