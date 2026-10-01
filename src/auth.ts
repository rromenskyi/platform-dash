import { SvelteKitAuth } from '@auth/sveltekit';
import { env } from '$env/dynamic/private';
import { resolveOidc, extractRoles } from '$lib/oidc-config';

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

// Generic OIDC provider — see $lib/oidc-config for the env contract.
// AUTH_SECRET is the cookie-encryption key — generate with `openssl rand -hex 32`.
//
// `$env/dynamic/private` resolves at runtime (process.env), so
// k8s ConfigMap/Secret injection works without a build-time .env.
const oidc = resolveOidc(env);

// Absolute session lifetime, independent of activity (see jwt()).
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export const { handle, signIn, signOut } = SvelteKitAuth({
	providers: [
		{
			id: oidc.id,
			name: oidc.name,
			type: 'oidc',
			issuer: oidc.issuer,
			clientId: oidc.clientId,
			clientSecret: oidc.clientSecret,
			// Default scope includes offline_access so we get a refresh token.
			authorization: { params: { scope: oidc.scope } }
		}
	],
	secret: env.AUTH_SECRET,
	trustHost: true,
	// Cookie lifetime matches the absolute cap enforced in jwt().
	session: { maxAge: SESSION_ABSOLUTE_MS / 1000 },
	callbacks: {
		// Keep the id_token + access_token on the JWT so server code
		// can call the IdP on behalf of the user. Roles come from the
		// id_token claim named by DASH_ROLES_CLAIM (Zitadel: enable
		// "assert roles on authentication"/id_token_role_assertion;
		// Keycloak/Authentik: add a groups mapper to the id_token).
		async jwt({ token, account }) {
			if (account) {
				token.accessToken = account.access_token;
				token.idToken = account.id_token;
				token.roles = extractRoles(decodeJwtPayload(account.id_token), oidc.rolesClaim);
				token.authAt = Date.now();
			}
			// Roles are read from the id_token only at sign-in, and the JWT
			// session slides on every request — an active user would keep
			// a role revoked in the IdP indefinitely. Force a fresh sign-in
			// (and fresh roles) after an absolute lifetime. Tokens minted
			// before authAt existed count as expired.
			if (!token.authAt || Date.now() - token.authAt > SESSION_ABSOLUTE_MS) {
				return null;
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
