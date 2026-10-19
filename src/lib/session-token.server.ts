import { getToken } from '@auth/core/jwt';
import { env } from '$env/dynamic/private';
import { ensureFresh } from '../auth';

// The signed-in user's current access token, refreshed if it is about
// to expire, or null when the session can't produce one. Call after
// locals.auth() so a refresh it triggered has already set the new
// cookie; ensureFresh() de-duplicates, so both see the same tokens.
export async function currentAccessToken(request: Request): Promise<string | null> {
	// Auth.js names the cookie from AUTH_URL / x-forwarded-proto (default
	// __Secure-); try that first, then the plain name.
	const opts = { req: request, secret: env.AUTH_SECRET };
	const token =
		(await getToken({ ...opts, secureCookie: true })) ??
		(await getToken({ ...opts, secureCookie: false }));
	if (!token) return null;
	const fresh = await ensureFresh(token);
	return fresh?.accessToken ?? null;
}
