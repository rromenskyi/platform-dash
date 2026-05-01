import type { PageServerLoad } from './$types';
import { batch } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type CronRow = {
	namespace: string;
	name: string;
	schedule: string;
	suspend: boolean;
	active: number;
	lastSchedule?: string;
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	let rows: CronRow[] = [];
	let error: string | null = null;
	try {
		const res = ns
			? await time(`${cluster}/listNamespacedCronJob`, () =>
					batch(cluster).listNamespacedCronJob({ namespace: ns })
				)
			: await time(`${cluster}/listCronJobForAllNamespaces`, () =>
					batch(cluster).listCronJobForAllNamespaces()
				);
		rows = res.items
			.map((c) => ({
				namespace: c.metadata?.namespace ?? '?',
				name: c.metadata?.name ?? '?',
				schedule: c.spec?.schedule ?? '?',
				suspend: !!c.spec?.suspend,
				active: c.status?.active?.length ?? 0,
				lastSchedule: c.status?.lastScheduleTime
					? new Date(c.status.lastScheduleTime).toISOString()
					: undefined,
				creationTimestamp: c.metadata?.creationTimestamp
					? new Date(c.metadata.creationTimestamp).toISOString()
					: undefined
			}))
			.sort((a, b) => {
				if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
				return a.name.localeCompare(b.name);
			});
	} catch (err) {
		console.error('list cronjobs failed', err);
		error = err instanceof Error ? err.message : String(err);
	}
	return { rows, error, cluster };
};
