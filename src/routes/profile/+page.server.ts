import { redirect } from '@sveltejs/kit';
import { getToken } from '@auth/core/jwt';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

// Auth gate. Anonymous visitors land on `/` with the sign-in CTA.
// Returning the session payload to the page lets it dump claims
// without a second await. The raw tokens are deliberately not on the
// session (see auth.ts) — read them from the JWT cookie for this
// debug page only.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}
	// Auth.js picks the cookie name from AUTH_URL / x-forwarded-proto and
	// defaults to the __Secure- variant, which needn't match event.url's
	// scheme behind the tunnel — try the secure name first, then plain.
	const opts = { req: event.request, secret: env.AUTH_SECRET };
	const token =
		(await getToken({ ...opts, secureCookie: true })) ??
		(await getToken({ ...opts, secureCookie: false }));
	return {
		session,
		idToken: token?.idToken,
		accessToken: token?.accessToken
	};
};
