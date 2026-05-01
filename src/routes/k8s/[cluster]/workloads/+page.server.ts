import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, apps } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type WorkloadRow = {
	namespace: string;
	name: string;
	kind: string;
	ready: string;
	status: string;
	restarts: number;
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

	const cluster = event.params.cluster;
	// Global namespace filter from /k8s/[cluster]/+layout.server.ts via
	// the URL. Empty string means "all namespaces".
	const ns = event.url.searchParams.get('ns') || '';

	const rows: WorkloadRow[] = [];
	const errors: string[] = [];

	// Independent fetches — one failing kind shouldn't blank the
	// whole table. Each block walks its own list under its own
	// try/catch and pushes any error onto a rolled-up banner.
	await Promise.all([
		(async () => {
			try {
				const res = ns
					? await time(`${cluster}/listNamespacedPod`, () =>
							core(cluster).listNamespacedPod({ namespace: ns })
						)
					: await time(`${cluster}/listPodForAllNamespaces`, () =>
							core(cluster).listPodForAllNamespaces()
						);
				for (const p of res.items) {
					const containers = p.status?.containerStatuses ?? [];
					const ready = containers.filter((c) => c.ready).length;
					const total = containers.length || (p.spec?.containers?.length ?? 0);
					const restarts = containers.reduce((acc, c) => acc + (c.restartCount ?? 0), 0);
					rows.push({
						namespace: p.metadata?.namespace ?? '?',
						name: p.metadata?.name ?? '?',
						kind: 'Pod',
						ready: `${ready}/${total}`,
						status: p.status?.phase ?? '?',
						restarts,
						creationTimestamp: p.metadata?.creationTimestamp
							? new Date(p.metadata.creationTimestamp).toISOString()
							: undefined
					});
				}
			} catch (err) {
				console.error('list pods failed', err);
				errors.push(`pods: ${err instanceof Error ? err.message : String(err)}`);
			}
		})(),
		(async () => {
			try {
				const res = ns
					? await time(`${cluster}/listNamespacedDeployment`, () =>
							apps(cluster).listNamespacedDeployment({ namespace: ns })
						)
					: await time(`${cluster}/listDeploymentForAllNamespaces`, () =>
							apps(cluster).listDeploymentForAllNamespaces()
						);
				for (const d of res.items) {
					const total = d.spec?.replicas ?? 0;
					const ready = d.status?.readyReplicas ?? 0;
					rows.push({
						namespace: d.metadata?.namespace ?? '?',
						name: d.metadata?.name ?? '?',
						kind: 'Deployment',
						ready: `${ready}/${total}`,
						status: ready === total ? 'Ready' : 'Pending',
						restarts: 0,
						creationTimestamp: d.metadata?.creationTimestamp
							? new Date(d.metadata.creationTimestamp).toISOString()
							: undefined
					});
				}
			} catch (err) {
				console.error('list deployments failed', err);
				errors.push(`deployments: ${err instanceof Error ? err.message : String(err)}`);
			}
		})(),
		(async () => {
			try {
				const res = ns
					? await time(`${cluster}/listNamespacedStatefulSet`, () =>
							apps(cluster).listNamespacedStatefulSet({ namespace: ns })
						)
					: await time(`${cluster}/listStatefulSetForAllNamespaces`, () =>
							apps(cluster).listStatefulSetForAllNamespaces()
						);
				for (const s of res.items) {
					const total = s.spec?.replicas ?? 0;
					const ready = s.status?.readyReplicas ?? 0;
					rows.push({
						namespace: s.metadata?.namespace ?? '?',
						name: s.metadata?.name ?? '?',
						kind: 'StatefulSet',
						ready: `${ready}/${total}`,
						status: ready === total ? 'Ready' : 'Pending',
						restarts: 0,
						creationTimestamp: s.metadata?.creationTimestamp
							? new Date(s.metadata.creationTimestamp).toISOString()
							: undefined
					});
				}
			} catch (err) {
				console.error('list statefulsets failed', err);
				errors.push(`statefulsets: ${err instanceof Error ? err.message : String(err)}`);
			}
		})()
	]);

	rows.sort((a, b) => {
		if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
		if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
		return a.name.localeCompare(b.name);
	});

	return { session, rows, cluster, error: errors.length ? errors.join('; ') : null };
};
