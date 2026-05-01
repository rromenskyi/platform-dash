import type { PageServerLoad } from './$types';
import { batch } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type JobRow = {
	namespace: string;
	name: string;
	completions: string;
	succeeded: number;
	failed: number;
	active: number;
	startTime?: string;
	completionTime?: string;
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	let rows: JobRow[] = [];
	let error: string | null = null;
	try {
		const res = ns
			? await time(`${cluster}/listNamespacedJob`, () =>
					batch(cluster).listNamespacedJob({ namespace: ns })
				)
			: await time(`${cluster}/listJobForAllNamespaces`, () =>
					batch(cluster).listJobForAllNamespaces()
				);
		rows = res.items
			.map((j) => {
				const completions = j.spec?.completions ?? 1;
				const succeeded = j.status?.succeeded ?? 0;
				return {
					namespace: j.metadata?.namespace ?? '?',
					name: j.metadata?.name ?? '?',
					completions: `${succeeded}/${completions}`,
					succeeded,
					failed: j.status?.failed ?? 0,
					active: j.status?.active ?? 0,
					startTime: j.status?.startTime
						? new Date(j.status.startTime).toISOString()
						: undefined,
					completionTime: j.status?.completionTime
						? new Date(j.status.completionTime).toISOString()
						: undefined,
					creationTimestamp: j.metadata?.creationTimestamp
						? new Date(j.metadata.creationTimestamp).toISOString()
						: undefined
				};
			})
			.sort((a, b) => {
				if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
				return a.name.localeCompare(b.name);
			});
	} catch (err) {
		console.error('list jobs failed', err);
		error = err instanceof Error ? err.message : String(err);
	}
	return { rows, error, cluster };
};
