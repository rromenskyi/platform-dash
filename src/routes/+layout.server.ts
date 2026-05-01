import type { LayoutServerLoad } from './$types';
import { canRead, canWrite } from '$lib/authz';
import { defaultCluster } from '$lib/clusters.server';

// Surface the Auth.js session on every page via $page.data.session.
// Keeping this in a layout (not per-page) means the topbar can show
// "Sign in" / "Sign out" without each route having to re-fetch.
// canRead/canWrite are derived once here so the sidebar + button
// visibility checks don't have to repeat the role lookup.
// defaultCluster is exposed so sidebar nav can land users on
// /k8s/<default>/... when they're not already inside a cluster path.
export const load: LayoutServerLoad = async (event) => {
	const session = await event.locals.auth();
	return {
		session,
		canRead: canRead(session),
		canWrite: canWrite(session),
		defaultCluster: defaultCluster()
	};
};
