import type { PageServerLoad } from './$types';
import { batch } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';

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
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	const accessible = accessibleNamespaces(session, cluster);
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
			.filter((c) => {
				if (accessible === 'all') return true;
				const n = c.metadata?.namespace;
				return !!n && accessible.includes(n);
			})
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
