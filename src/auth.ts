import { SvelteKitAuth } from '@auth/sveltekit';
import ZITADEL from '@auth/core/providers/zitadel';
import { env } from '$env/dynamic/private';

// Decode the payload of a JWT (no signature verify — the token came
// from our IdP via the OAuth code flow that Auth.js already validated).
// Returns null on any malformed input so a bad token can't crash login.
function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> | null {
	if (!jwt) return null;
	const parts = jwt.split('.');
	if (parts.length < 2) return null;
	try {
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
		const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
		return JSON.parse(json);
	} catch {
		return null;
	}
}

// Zitadel emits the project-roles claim shaped as
//   { "<roleKey>": { "<orgId>": "<orgPrimaryDomain>" }, ... }
// We only need the role keys (e.g. "platform_admin", "platform_sre").
function extractZitadelRoles(idToken: string | undefined): string[] {
	const payload = decodeJwtPayload(idToken);
	if (!payload) return [];
	const claim = payload['urn:zitadel:iam:org:project:roles'];
	if (!claim || typeof claim !== 'object') return [];
	return Object.keys(claim);
}

// Zitadel provider via Auth.js. Three env vars do the wiring:
//   AUTH_ZITADEL_ISSUER  — `https://id.<your-domain>` (no trailing slash)
//   AUTH_ZITADEL_ID      — OIDC client_id from Zitadel Application
//   AUTH_ZITADEL_SECRET  — OIDC client_secret (or empty for PKCE-only public clients)
// AUTH_SECRET is the cookie-encryption key — generate with `openssl rand -hex 32`.
//
// `$env/dynamic/private` resolves at runtime (process.env), so
// k8s ConfigMap/Secret injection works without a build-time .env.
export const { handle, signIn, signOut } = SvelteKitAuth({
	providers: [
		ZITADEL({
			clientId: env.AUTH_ZITADEL_ID,
			clientSecret: env.AUTH_ZITADEL_SECRET,
			issuer: env.AUTH_ZITADEL_ISSUER,
			// Pull standard OIDC claims plus offline_access so we get a
			// refresh token — Auth.js rotates it for us behind the scenes.
			authorization: { params: { scope: 'openid email profile offline_access' } }
		})
	],
	secret: env.AUTH_SECRET,
	trustHost: true,
	callbacks: {
		// Keep the id_token + access_token on the JWT so server code
		// can call Zitadel APIs on behalf of the user. Also pull the
		// project roles claim out of the id_token — Zitadel emits them under
		// `urn:zitadel:iam:org:project:roles` when the Application has
		// `id_token_role_assertion = true` (set in the platform repo's
		// modules/zitadel-app).
		async jwt({ token, account }) {
			if (account) {
				token.accessToken = account.access_token;
				token.idToken = account.id_token;
				token.roles = extractZitadelRoles(account.id_token);
			}
			return token;
		},
		// Tokens stay in the encrypted JWT cookie only. Every layout
		// returns the session to the page, so putting them here would
		// serialize bearer tokens into every page's HTML/__data.json
		// (and /auth/session). /profile reads them via getToken().
		async session({ session, token }) {
			session.roles = (token.roles as string[] | undefined) ?? [];
			return session;
		}
	}
});
