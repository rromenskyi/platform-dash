import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type NamespaceRow = {
	name: string;
	phase: string;
	labels: Record<string, string>;
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const cluster = event.params.cluster;
	let rows: NamespaceRow[] = [];
	let error: string | null = null;
	try {
		const res = await time(`${cluster}/listNamespace`, () => core(cluster).listNamespace());
		rows = res.items
			.map((n) => ({
				name: n.metadata?.name ?? '?',
				phase: n.status?.phase ?? '?',
				labels: (n.metadata?.labels ?? {}) as Record<string, string>,
				creationTimestamp: n.metadata?.creationTimestamp
					? new Date(n.metadata.creationTimestamp).toISOString()
					: undefined
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch (err) {
		console.error('list namespaces failed', err);
		error = err instanceof Error ? err.message : String(err);
	}
	return { rows, error, cluster };
};
