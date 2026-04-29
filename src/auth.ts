import { SvelteKitAuth } from '@auth/sveltekit';
import ZITADEL from '@auth/core/providers/zitadel';
import { env } from '$env/dynamic/private';

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
		// Surface the id_token + access_token onto the session so
		// downstream routes can call Zitadel APIs or the sipmesh
		// backend on behalf of the user.
		async jwt({ token, account }) {
			if (account) {
				token.accessToken = account.access_token;
				token.idToken = account.id_token;
			}
			return token;
		},
		async session({ session, token }) {
			session.accessToken = token.accessToken as string | undefined;
			session.idToken = token.idToken as string | undefined;
			return session;
		}
	}
});
