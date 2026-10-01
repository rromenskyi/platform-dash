// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveOidc, extractRoles, ZITADEL_ROLES_CLAIM } from './oidc-config';

describe('resolveOidc', () => {
	it('keeps the legacy Zitadel env and provider id', () => {
		const c = resolveOidc({ AUTH_ZITADEL_ISSUER: 'https://id.x', AUTH_ZITADEL_ID: 'c', AUTH_ZITADEL_SECRET: 's' });
		expect(c).toMatchObject({ id: 'zitadel', name: 'Zitadel', issuer: 'https://id.x', clientId: 'c', clientSecret: 's', rolesClaim: ZITADEL_ROLES_CLAIM });
	});

	it('uses generic OIDC settings when set', () => {
		const c = resolveOidc({
			AUTH_OIDC_ISSUER: 'https://kc.x/realms/r',
			AUTH_OIDC_CLIENT_ID: 'dash',
			AUTH_OIDC_PROVIDER_NAME: 'Keycloak',
			DASH_ROLES_CLAIM: 'groups'
		});
		expect(c).toMatchObject({ id: 'oidc', name: 'Keycloak', issuer: 'https://kc.x/realms/r', clientId: 'dash', rolesClaim: 'groups' });
		expect(c.scope).toBe('openid email profile offline_access');
	});
});

describe('extractRoles', () => {
	it('reads Zitadel project-role keys', () => {
		const p = { [ZITADEL_ROLES_CLAIM]: { platform_admin: { '1': 'org' }, user: {} } };
		expect(extractRoles(p, ZITADEL_ROLES_CLAIM)).toEqual(['platform_admin', 'user']);
	});

	it('reads a groups array, stripping Keycloak group paths', () => {
		expect(extractRoles({ groups: ['/platform_sre', 'namespace_mail_admin', 3] }, 'groups')).toEqual([
			'platform_sre',
			'namespace_mail_admin'
		]);
	});

	it('follows a dot path (Keycloak realm roles)', () => {
		expect(extractRoles({ realm_access: { roles: ['platform_admin'] } }, 'realm_access.roles')).toEqual([
			'platform_admin'
		]);
	});

	it('splits a flat string and tolerates missing claims', () => {
		expect(extractRoles({ roles: 'platform_sre, x' }, 'roles')).toEqual(['platform_sre', 'x']);
		expect(extractRoles({}, 'groups')).toEqual([]);
		expect(extractRoles(null, 'groups')).toEqual([]);
	});
});
