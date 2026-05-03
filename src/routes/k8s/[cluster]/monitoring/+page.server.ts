import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canRead } from '$lib/authz';

// Placeholder. Real metrics live in Grafana; this page is a stable
// hook so the sidebar entry doesn't 404, and we have somewhere to
// drop in-dash visualisations later.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) throw redirect(303, '/');
	const cluster = event.params.cluster;
	if (!canRead(session, cluster)) throw redirect(303, '/');

	return {
		session,
		cluster,
		grafanaUrl: 'https://grafana.ipsupport.us'
	};
};
