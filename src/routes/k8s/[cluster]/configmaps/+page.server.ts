import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type CmRow = {
	namespace: string;
	name: string;
	keys: string[];
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	let rows: CmRow[] = [];
	let error: string | null = null;
	try {
		const res = ns
			? await time(`${cluster}/listNamespacedConfigMap`, () =>
					core(cluster).listNamespacedConfigMap({ namespace: ns })
				)
			: await time(`${cluster}/listConfigMapForAllNamespaces`, () =>
					core(cluster).listConfigMapForAllNamespaces()
				);
		rows = res.items
			.map((c) => ({
				namespace: c.metadata?.namespace ?? '?',
				name: c.metadata?.name ?? '?',
				keys: Object.keys((c.data ?? {}) as Record<string, string>),
				creationTimestamp: c.metadata?.creationTimestamp
					? new Date(c.metadata.creationTimestamp).toISOString()
					: undefined
			}))
			.sort((a, b) => {
				if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
				return a.name.localeCompare(b.name);
			});
	} catch (err) {
		console.error('list configmaps failed', err);
		error = err instanceof Error ? err.message : String(err);
	}
	return { rows, error, cluster };
};
