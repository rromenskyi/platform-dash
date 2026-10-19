import { extractRoles } from './oidc-config';

// Access-token refresh for the OIDC session.
//
// The access token is forwarded to plugin back ends, so it must not be
// handed out stale. ensureFresh() refreshes it shortly before expiry
// with the refresh token (we request offline_access).
//
// IdPs such as Zitadel rotate refresh tokens: the old one is dead after
// first use. Several requests can arrive with the same (old) session
// cookie — parallel loads, or the WS bridge in start.js, which reads the
// session but can't persist the re-issued cookie. So refreshes are
// de-duplicated per old refresh token and the result is remembered for
// a few minutes: every request carrying that cookie gets the same new
// token set instead of burning the rotated token again.

export type TokenSet = {
	accessToken?: string;
	idToken?: string;
	refreshToken?: string;
	expiresAt?: number; // epoch seconds
	roles?: string[];
};

type Deps = {
	issuer?: string;
	clientId?: string;
	clientSecret?: string;
	rolesClaim: string;
	fetch?: typeof fetch;
	now?: () => number; // ms
};

const SKEW_S = 60;
const REMEMBER_MS = 5 * 60 * 1000;

export function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> | null {
	if (!jwt) return null;
	const parts = jwt.split('.');
	if (parts.length < 2) return null;
	try {
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
		return JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

export function createRefresher(deps: Deps) {
	const doFetch = deps.fetch ?? fetch;
	const now = deps.now ?? Date.now;
	const recent = new Map<string, { at: number; result: Promise<TokenSet | null> }>();
	let endpoint: Promise<string> | null = null;

	function tokenEndpoint(): Promise<string> {
		endpoint ??= doFetch(`${deps.issuer}/.well-known/openid-configuration`)
			.then((r) => {
				if (!r.ok) throw new Error(`discovery ${r.status}`);
				return r.json();
			})
			.then((d: { token_endpoint?: string }) => {
				if (!d.token_endpoint) throw new Error('no token_endpoint');
				return d.token_endpoint;
			})
			.catch((e) => {
				endpoint = null; // retry discovery next time
				throw e;
			});
		return endpoint;
	}

	async function refresh(t: TokenSet): Promise<TokenSet | null> {
		const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken! });
		const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
		if (deps.clientSecret) {
			const basic = `${encodeURIComponent(deps.clientId ?? '')}:${encodeURIComponent(deps.clientSecret)}`;
			headers.authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
		} else {
			body.set('client_id', deps.clientId ?? '');
		}
		let res: Response;
		try {
			res = await doFetch(await tokenEndpoint(), { method: 'POST', headers, body });
		} catch {
			// IdP unreachable: keep a still-valid token, drop an expired one.
			return t.expiresAt && t.expiresAt > now() / 1000 ? t : null;
		}
		if (!res.ok) return null; // refresh token revoked/expired → sign in again
		const j = (await res.json()) as {
			access_token?: string;
			expires_in?: number;
			refresh_token?: string;
			id_token?: string;
		};
		if (!j.access_token) return null;
		return {
			accessToken: j.access_token,
			expiresAt: j.expires_in ? Math.floor(now() / 1000) + j.expires_in : undefined,
			refreshToken: j.refresh_token ?? t.refreshToken,
			idToken: j.id_token ?? t.idToken,
			// A refreshed id_token carries current roles — pick them up.
			roles: j.id_token ? extractRoles(decodeJwtPayload(j.id_token), deps.rolesClaim) : t.roles
		};
	}

	// Returns the token set to use (possibly refreshed), or null when the
	// session can no longer produce a valid access token.
	return async function ensureFresh(t: TokenSet): Promise<TokenSet | null> {
		if (!t.expiresAt || t.expiresAt - SKEW_S > now() / 1000) return t;
		if (!t.refreshToken) return t.expiresAt > now() / 1000 ? t : null;

		for (const [k, v] of recent) if (now() - v.at > REMEMBER_MS) recent.delete(k);
		let entry = recent.get(t.refreshToken);
		if (!entry) {
			const key = t.refreshToken;
			const result = refresh(t).then((r) => {
				// Transient failure handed back the old set: don't remember
				// it, or it would keep being served after it expires.
				if (r === t) recent.delete(key);
				return r;
			});
			entry = { at: now(), result };
			recent.set(key, entry);
		}
		return entry.result;
	};
}
