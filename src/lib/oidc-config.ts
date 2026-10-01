// Provider-agnostic OIDC settings. Any OIDC IdP works (Zitadel,
// Keycloak, Authentik, Dex, …):
//   AUTH_OIDC_ISSUER / AUTH_OIDC_CLIENT_ID / AUTH_OIDC_CLIENT_SECRET
//   AUTH_OIDC_PROVIDER_ID   — callback path segment (default "oidc":
//                             redirect URI is <origin>/auth/callback/oidc)
//   AUTH_OIDC_PROVIDER_NAME — sign-in button label (default "SSO")
//   AUTH_OIDC_SCOPE         — default "openid email profile offline_access"
//   DASH_ROLES_CLAIM        — id_token claim holding the roles, dot path
//                             allowed (e.g. "groups", "realm_access.roles");
//                             default is Zitadel's project-roles claim
// The legacy AUTH_ZITADEL_ISSUER / _ID / _SECRET are still honoured and
// keep provider id "zitadel", so existing redirect URIs don't change.

export const ZITADEL_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles';

export type OidcConfig = {
	id: string;
	name: string;
	issuer?: string;
	clientId?: string;
	clientSecret?: string;
	scope: string;
	rolesClaim: string;
};

type Env = Record<string, string | undefined>;

export function resolveOidc(env: Env): OidcConfig {
	const legacy = !env.AUTH_OIDC_ISSUER && !!env.AUTH_ZITADEL_ISSUER;
	return {
		id: env.AUTH_OIDC_PROVIDER_ID || (legacy ? 'zitadel' : 'oidc'),
		name: env.AUTH_OIDC_PROVIDER_NAME || (legacy ? 'Zitadel' : 'SSO'),
		issuer: env.AUTH_OIDC_ISSUER || env.AUTH_ZITADEL_ISSUER,
		clientId: env.AUTH_OIDC_CLIENT_ID || env.AUTH_ZITADEL_ID,
		clientSecret: env.AUTH_OIDC_CLIENT_SECRET || env.AUTH_ZITADEL_SECRET,
		scope: env.AUTH_OIDC_SCOPE || 'openid email profile offline_access',
		rolesClaim: env.DASH_ROLES_CLAIM || ZITADEL_ROLES_CLAIM
	};
}

// Pull role names out of a decoded token payload. Accepts the shapes
// IdPs actually emit:
//   object  { "<role>": {...} }   — Zitadel project roles (keys)
//   array   ["admin", "/team/x"]  — Keycloak/Authentik/Dex groups
//   string  "a b" / "a,b"         — some IdPs flatten to one string
// The claim name is looked up verbatim first (Zitadel's contains dots),
// then as a dot path.
export function extractRoles(payload: Record<string, unknown> | null, claim: string): string[] {
	if (!payload) return [];
	let v: unknown = payload[claim];
	if (v === undefined && claim.includes('.')) {
		v = claim.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), payload);
	}
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map(stripGroupPath);
	if (typeof v === 'string') return v.split(/[\s,]+/).filter(Boolean);
	if (v && typeof v === 'object') return Object.keys(v);
	return [];
}

// Keycloak emits group paths ("/platform_admin"); match on the leaf.
function stripGroupPath(s: string): string {
	return s.startsWith('/') ? (s.split('/').pop() ?? s) : s;
}
