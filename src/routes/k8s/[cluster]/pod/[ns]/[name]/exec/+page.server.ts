import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canWrite } from '$lib/authz';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const { cluster, ns, name } = event.params;
	if (!session?.user) throw redirect(303, '/');
	if (!canWrite(session, cluster)) {
		// Match the http-test gate: SRE / readers can't open shells.
		// Audit logs would be polluted with denials otherwise; bounce.
		throw redirect(303, `/k8s/${cluster}/pod/${ns}/${name}`);
	}

	let containers: string[] = [];
	let initContainers: string[] = [];
	try {
		const pod = await time(`${cluster}/readNamespacedPod`, () =>
			core(cluster).readNamespacedPod({ name, namespace: ns })
		);
		containers = (pod.spec?.containers ?? []).map((c) => c.name);
		initContainers = (pod.spec?.initContainers ?? []).map((c) => c.name);
	} catch (err) {
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `Pod ${ns}/${name} not found`);
	}

	const initial = event.url.searchParams.get('container') ?? containers[0] ?? '';
	return { cluster, ns, name, containers, initContainers, initial };
};
