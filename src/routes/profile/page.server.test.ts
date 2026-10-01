// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { encode } from '@auth/core/jwt';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: SECRET } }));

const { load } = await import('./+page.server');

async function event(protocol: 'http:' | 'https:') {
	const name = protocol === 'https:' ? '__Secure-authjs.session-token' : 'authjs.session-token';
	const jwt = await encode({
		token: { sub: 'u', idToken: 'id.tok', accessToken: 'acc.tok', roles: ['platform_admin'] },
		secret: SECRET,
		salt: name
	});
	return {
		url: new URL(`${protocol}//dash.example/profile`),
		request: new Request(`${protocol}//dash.example/profile`, {
			headers: { cookie: `${name}=${jwt}` }
		}),
		locals: { auth: async () => ({ user: { email: 'u@x' }, roles: ['platform_admin'] }) }
	} as unknown as Parameters<typeof load>[0];
}

describe('profile loader', () => {
	it.each(['http:', 'https:'] as const)('reads tokens from the JWT cookie over %s', async (p) => {
		const data = (await load(await event(p))) as Record<string, unknown>;
		expect(data.idToken).toBe('id.tok');
		expect(data.accessToken).toBe('acc.tok');
		expect(data.session).not.toHaveProperty('accessToken');
	});
});
