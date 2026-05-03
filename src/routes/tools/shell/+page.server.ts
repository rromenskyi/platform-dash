import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canWrite } from '$lib/authz';
import { listClusters, defaultCluster } from '$lib/clusters.server';

// Ephemeral cloudshell. Operator opens this page → start.js spins up
// a one-shot pod for the session and bridges its TTY over WS. Auth
// gate is global `canWrite` (platform_admin only); cluster-scoped
// admins don't get a cloudshell because the pod is created in the
// shared `platform` namespace.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) throw redirect(303, '/');
	if (!canWrite(session)) throw redirect(303, '/');

	return {
		session,
		clusters: listClusters(),
		defaultCluster: defaultCluster()
	};
};
