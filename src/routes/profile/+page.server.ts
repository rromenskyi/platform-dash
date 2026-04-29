import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Auth gate. Anonymous visitors land on `/` with the sign-in CTA.
// Returning the session payload to the page lets it dump claims
// without a second await.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}
	return { session };
};
