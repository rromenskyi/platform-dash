import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { requireRead } from '$lib/authz';

// We re-read the pod here (cheap) so the page can render a container
// picker without round-tripping the parent +page.server.ts. The
// streaming endpoint (+server.ts in this folder) handles the actual
// log delivery; this loader only sets up the chooser UI.
export const load: PageServerLoad = async (event) => {
	const { cluster, ns, name } = event.params;
	// Page loads can run without the layouts (__data.json with
	// x-sveltekit-invalidated), so this loader must gate itself.
	const session = await event.locals.auth();
	requireRead(session, cluster, ns);

	let pod;
	try {
		pod = await time(`${cluster}/readNamespacedPod`, () =>
			core(cluster).readNamespacedPod({ name, namespace: ns })
		);
	} catch (err) {
		console.error('read pod failed', err);
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `Pod "${ns}/${name}" not found`);
	}

	const containers = (pod.spec?.containers ?? []).map((c) => c.name);
	const initContainers = (pod.spec?.initContainers ?? []).map((c) => c.name);

	const requested = event.url.searchParams.get('container') || '';
	const initialContainer =
		requested && [...containers, ...initContainers].includes(requested)
			? requested
			: (containers[0] ?? '');

	return {
		cluster,
		ns,
		name,
		containers,
		initContainers,
		initialContainer
	};
};
