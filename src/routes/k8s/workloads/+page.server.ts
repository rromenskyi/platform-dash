import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, apps } from '$lib/k8s';

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

	const rows: WorkloadRow[] = [];
	let error: string | null = null;

	try {
		const [podsRes, depsRes, ssRes] = await Promise.all([
			core().listPodForAllNamespaces(),
			apps().listDeploymentForAllNamespaces(),
			apps().listStatefulSetForAllNamespaces()
		]);

		for (const p of podsRes.items) {
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
				creationTimestamp: p.metadata?.creationTimestamp?.toString()
			});
		}

		for (const d of depsRes.items) {
			const total = d.spec?.replicas ?? 0;
			const ready = d.status?.readyReplicas ?? 0;
			rows.push({
				namespace: d.metadata?.namespace ?? '?',
				name: d.metadata?.name ?? '?',
				kind: 'Deployment',
				ready: `${ready}/${total}`,
				status: ready === total ? 'Ready' : 'Pending',
				restarts: 0,
				creationTimestamp: d.metadata?.creationTimestamp?.toString()
			});
		}

		for (const s of ssRes.items) {
			const total = s.spec?.replicas ?? 0;
			const ready = s.status?.readyReplicas ?? 0;
			rows.push({
				namespace: s.metadata?.namespace ?? '?',
				name: s.metadata?.name ?? '?',
				kind: 'StatefulSet',
				ready: `${ready}/${total}`,
				status: ready === total ? 'Ready' : 'Pending',
				restarts: 0,
				creationTimestamp: s.metadata?.creationTimestamp?.toString()
			});
		}

		rows.sort((a, b) => {
			if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
			if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
			return a.name.localeCompare(b.name);
		});
	} catch (err) {
		console.error('workloads load failed', err);
		error = err instanceof Error ? err.message : String(err);
	}

	return { session, rows, error };
};
