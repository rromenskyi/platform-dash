import { error, type Handle } from '@sveltejs/kit';

// SvelteKit's built-in CSRF check only covers form content types, so
// our JSON POST endpoints (scale, restart, pod-delete, secret-reveal,
// …) accepted a credentialed cross-origin POST sent with no
// Content-Type — reachable from any same-site origin, where the
// SameSite=Lax session cookie is still attached. Browsers always send
// Origin on cross-origin POSTs, so reject a mismatching one.
//
// Compared by host, like start.js's WS originAllowed(): behind the
// tunnel the scheme SvelteKit sees can differ from the public one.
// Missing Origin (curl, server-to-server) is allowed — cookies still
// gate auth. OIDC callbacks are exempt: Auth.js protects them with
// state/PKCE, and an IdP form_post legitimately comes cross-origin.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfHandle: Handle = ({ event, resolve }) => {
	const { request, url } = event;
	if (!SAFE_METHODS.has(request.method) && !url.pathname.startsWith('/auth/callback/')) {
		const origin = request.headers.get('origin');
		if (origin !== null && !sameHost(origin, url.host)) {
			throw error(403, 'cross-origin request rejected');
		}
	}
	return resolve(event);
};

function sameHost(origin: string, host: string): boolean {
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

// request.json() throws SyntaxError on an empty/malformed body, which
// surfaced as a 500 "Internal Error". Make it the client's 400.
export async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw error(400, 'invalid JSON body');
	}
}
