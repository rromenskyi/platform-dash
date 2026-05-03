import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';

export type CmRow = {
	namespace: string;
	name: string;
	keys: string[];
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	const accessible = accessibleNamespaces(session, cluster);
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
			.filter((c) => {
				if (accessible === 'all') return true;
				const n = c.metadata?.namespace;
				return !!n && accessible.includes(n);
			})
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
