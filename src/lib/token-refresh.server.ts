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
// the session's lifetime: any request still carrying that cookie gets
// the rotated set (refreshed again in turn if that one has expired)
// instead of replaying a dead refresh token.
//
// The map is per process: run a single replica (the chart default) or
// pin sessions to a pod, or concurrent refreshes on two pods race.

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
const REMEMBER_MS = 12 * 60 * 60 * 1000; // = absolute session lifetime
const IDP_TIMEOUT_MS = 10_000;
// Used when the token response omits expires_in, so the token is still
// refreshed instead of being treated as fresh forever.
const DEFAULT_TTL_S = 300;

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
		endpoint ??= doFetch(`${deps.issuer}/.well-known/openid-configuration`, {
			signal: AbortSignal.timeout(IDP_TIMEOUT_MS)
		})
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
		// Transient trouble (unreachable, timeout, 5xx/429, garbage body):
		// keep a still-valid token and don't remember the outcome; only an
		// explicit rejection of the refresh token ends the session.
		const transient = () => (t.expiresAt && t.expiresAt > now() / 1000 ? t : null);
		let j: { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string };
		try {
			const res = await doFetch(await tokenEndpoint(), {
				method: 'POST',
				headers,
				body,
				signal: AbortSignal.timeout(IDP_TIMEOUT_MS)
			});
			if (res.status === 400 || res.status === 401) return null; // invalid_grant / invalid_client
			if (!res.ok) return transient();
			j = await res.json();
		} catch {
			return transient();
		}
		if (!j?.access_token) return transient();
		return {
			accessToken: j.access_token,
			expiresAt: Math.floor(now() / 1000) + (j.expires_in || DEFAULT_TTL_S),
			refreshToken: j.refresh_token ?? t.refreshToken,
			idToken: j.id_token ?? t.idToken,
			// A refreshed id_token carries current roles — pick them up.
			roles: j.id_token ? extractRoles(decodeJwtPayload(j.id_token), deps.rolesClaim) : t.roles
		};
	}

	// Returns the token set to use (possibly refreshed), or null when the
	// session can no longer produce a valid access token.
	async function ensureFresh(t: TokenSet, hop = 0): Promise<TokenSet | null> {
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
		const r = await entry.result;
		// A remembered rotation may itself be near expiry by now (the
		// browser never received it): refresh onward from it — one hop, so
		// an IdP issuing sub-minute tokens can't loop us.
		return r && r !== t && hop === 0 ? ensureFresh(r, 1) : r;
	}

	return ensureFresh;
}
