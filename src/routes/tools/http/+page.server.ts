import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canWrite } from '$lib/authz';

// Cluster-agnostic HTTP tester. Lived under `/k8s/[cluster]/http-test`
// originally — moved out since it's a generic Postman-lite tool that
// doesn't care which cluster you're "in". Auth gate is on global
// admin (no cluster argument), so cluster-scoped roles can't open it.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) throw redirect(303, '/');
	if (!canWrite(session)) {
		// SRE / cluster-only roles get bounced. Headers + bodies in
		// requests routinely carry secrets that aren't theirs to see.
		throw redirect(303, '/');
	}
	return { session };
};
