import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canWrite } from '$lib/authz';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	if (!session?.user) throw redirect(303, '/');
	if (!canWrite(session, cluster)) {
		// Match the other admin-gated tools: bounce SRE / readers off
		// the page entirely — request bodies + headers can carry
		// secrets, so this isn't an SRE-safe surface.
		throw redirect(303, `/k8s/${cluster}`);
	}
	return { session, cluster };
};
