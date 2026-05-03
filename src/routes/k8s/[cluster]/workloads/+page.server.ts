import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, apps } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';

export type WorkloadRow = {
	namespace: string;
	name: string;
	kind: string;
	ready: string;
	status: string;
	restarts: number;
	creationTimestamp?: string;
	// Pods only — Deployment / StatefulSet rows roll up multiple pods,
	// no single node makes sense at that level.
	node?: string;
	// First container's image. For multi-container pods this is just
	// the first; full image list lives on the pod detail page. For
	// Deployment / StatefulSet rows we pull from spec.template.
	image?: string;
	// Set when any container is in ImagePullBackOff / ErrImagePull —
	// surfaces inline on the workloads table without a click-through.
	imagePullError?: boolean;
	// Reason from the most recent termination across this pod's
	// containers (lastState.terminated.reason). Useful primarily for
	// surfacing OOMKilled inline; non-Pod rows don't set it.
	lastTermReason?: string;
};

function pickLastTermReason(containers: { lastState?: { terminated?: { reason?: string } } }[]): string | undefined {
	// Prefer OOMKilled if any container has it — that's the failure
	// mode operators care most about. Otherwise return whatever the
	// first terminated container reports.
	for (const c of containers) {
		if (c.lastState?.terminated?.reason === 'OOMKilled') return 'OOMKilled';
	}
	for (const c of containers) {
		const r = c.lastState?.terminated?.reason;
		if (r) return r;
	}
	return undefined;
}

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
					const image = p.spec?.containers?.[0]?.image;
					const imagePullError = containers.some((c) => {
						const r = c.state?.waiting?.reason ?? '';
						return r === 'ImagePullBackOff' || r === 'ErrImagePull';
					});
					const lastTermReason = pickLastTermReason(containers);
					rows.push({
						namespace: p.metadata?.namespace ?? '?',
						name: p.metadata?.name ?? '?',
						kind: 'Pod',
						ready: `${ready}/${total}`,
						status: p.status?.phase ?? '?',
						restarts,
						creationTimestamp: p.metadata?.creationTimestamp
							? new Date(p.metadata.creationTimestamp).toISOString()
							: undefined,
						node: p.spec?.nodeName,
						image,
						imagePullError,
						lastTermReason
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
							: undefined,
						image: d.spec?.template?.spec?.containers?.[0]?.image
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
							: undefined,
						image: s.spec?.template?.spec?.containers?.[0]?.image
					});
				}
			} catch (err) {
				console.error('list statefulsets failed', err);
				errors.push(`statefulsets: ${err instanceof Error ? err.message : String(err)}`);
			}
		})()
	]);

	// For ns-only operators, drop rows in namespaces they have no
	// role for. Filtering server-side keeps the row count stat
	// honest and avoids leaking pod names through the SSE delta path.
	const accessible = accessibleNamespaces(session, cluster);
	const filtered = accessible === 'all' ? rows : rows.filter((r) => accessible.includes(r.namespace));

	filtered.sort((a, b) => {
		if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
		if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
		return a.name.localeCompare(b.name);
	});

	return { session, rows: filtered, cluster, error: errors.length ? errors.join('; ') : null };
};
