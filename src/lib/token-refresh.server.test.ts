// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createRefresher, type TokenSet } from './token-refresh.server';

const NOW = 1_800_000_000_000;
const idToken = (roles: string[]) =>
	`h.${Buffer.from(JSON.stringify({ groups: roles })).toString('base64url')}.s`;

function setup(tokenResponse: () => Response | Promise<Response>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		if (url.endsWith('/.well-known/openid-configuration')) {
			return Response.json({ token_endpoint: 'https://idp/oauth/token' });
		}
		return tokenResponse();
	}) as unknown as typeof globalThis.fetch;
	const ensureFresh = createRefresher({
		issuer: 'https://idp',
		clientId: 'dash',
		clientSecret: 's3cret',
		rolesClaim: 'groups',
		fetch,
		now: () => NOW
	});
	const tokenCalls = () => calls.filter((c) => c.url === 'https://idp/oauth/token');
	return { ensureFresh, tokenCalls };
}

const expiring: TokenSet = {
	accessToken: 'old',
	refreshToken: 'r1',
	expiresAt: NOW / 1000 + 10, // inside the 60s skew
	roles: ['platform_sre']
};

describe('ensureFresh', () => {
	it('leaves a token with time to spare alone', async () => {
		const { ensureFresh, tokenCalls } = setup(() => Response.json({}));
		const t = { ...expiring, expiresAt: NOW / 1000 + 3600 };
		expect(await ensureFresh(t)).toBe(t);
		expect(tokenCalls()).toHaveLength(0);
	});

	it('refreshes near expiry, rotates the refresh token and re-reads roles', async () => {
		const { ensureFresh, tokenCalls } = setup(() =>
			Response.json({
				access_token: 'new',
				expires_in: 3600,
				refresh_token: 'r2',
				id_token: idToken(['platform_admin'])
			})
		);
		const r = await ensureFresh(expiring);
		expect(r).toMatchObject({ accessToken: 'new', refreshToken: 'r2', roles: ['platform_admin'] });
		expect(r?.expiresAt).toBe(NOW / 1000 + 3600);
		const init = tokenCalls()[0].init!;
		expect((init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
		expect(String(init.body)).toContain('grant_type=refresh_token');
		expect(String(init.body)).toContain('refresh_token=r1');
	});

	it('refreshes once for concurrent requests carrying the same old token', async () => {
		const { ensureFresh, tokenCalls } = setup(() =>
			Response.json({ access_token: 'new', expires_in: 3600, refresh_token: 'r2' })
		);
		const [a, b, c] = await Promise.all([
			ensureFresh({ ...expiring }),
			ensureFresh({ ...expiring }),
			ensureFresh({ ...expiring })
		]);
		expect(tokenCalls()).toHaveLength(1);
		expect([a?.accessToken, b?.accessToken, c?.accessToken]).toEqual(['new', 'new', 'new']);
		// A later request with the stale cookie still gets the rotated set.
		expect((await ensureFresh({ ...expiring }))?.refreshToken).toBe('r2');
		expect(tokenCalls()).toHaveLength(1);
	});

	it('keeps a still-valid token on a 5xx/429 and retries next time', async () => {
		let status = 503;
		const { ensureFresh, tokenCalls } = setup(() =>
			status === 200
				? Response.json({ access_token: 'new', expires_in: 3600 })
				: new Response('busy', { status })
		);
		expect((await ensureFresh(expiring))?.accessToken).toBe('old');
		status = 429;
		expect((await ensureFresh(expiring))?.accessToken).toBe('old');
		status = 200;
		expect((await ensureFresh(expiring))?.accessToken).toBe('new');
		expect(tokenCalls()).toHaveLength(3);
	});

	it('keeps a still-valid token on a non-JSON 200', async () => {
		const { ensureFresh } = setup(() => new Response('<html>oops</html>', { status: 200 }));
		expect((await ensureFresh(expiring))?.accessToken).toBe('old');
	});

	it('gives tokens without expires_in a short lifetime instead of none', async () => {
		const { ensureFresh } = setup(() => Response.json({ access_token: 'new' }));
		expect((await ensureFresh(expiring))?.expiresAt).toBe(NOW / 1000 + 300);
	});

	it('ends the session when the IdP rejects the refresh token', async () => {
		const { ensureFresh } = setup(() => new Response('{"error":"invalid_grant"}', { status: 400 }));
		expect(await ensureFresh(expiring)).toBeNull();
	});

	it('treats other 4xx errors as transient', async () => {
		const { ensureFresh } = setup(() => new Response('{"error":"invalid_request"}', { status: 400 }));
		expect((await ensureFresh(expiring))?.accessToken).toBe('old');
	});

	it('refreshes a token with unknown expiry when it can', async () => {
		const { ensureFresh, tokenCalls } = setup(() => Response.json({ access_token: 'new', expires_in: 60 }));
		const legacy = { accessToken: 'old', refreshToken: 'rx' };
		expect((await ensureFresh(legacy))?.accessToken).toBe('new');
		expect(tokenCalls()).toHaveLength(1);
		const noRefresh = { accessToken: 'old' };
		expect(await ensureFresh(noRefresh)).toBe(noRefresh);
	});

	it('keeps a still-valid token on a network error, without caching it', async () => {
		let fail = true;
		const { ensureFresh, tokenCalls } = setup(() => {
			if (fail) throw new Error('ECONNREFUSED');
			return Response.json({ access_token: 'new', expires_in: 3600 });
		});
		expect((await ensureFresh(expiring))?.accessToken).toBe('old');
		fail = false;
		expect((await ensureFresh(expiring))?.accessToken).toBe('new');
		expect(tokenCalls()).toHaveLength(2);
	});

	it('drops an already expired token on a network error', async () => {
		const { ensureFresh } = setup(() => {
			throw new Error('ECONNREFUSED');
		});
		expect(await ensureFresh({ ...expiring, expiresAt: NOW / 1000 - 5 })).toBeNull();
	});

	it('refreshes onward from a remembered rotation that has since expired', async () => {
		let now = NOW;
		let n = 0;
		const calls: string[] = [];
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith('/.well-known/openid-configuration')) {
				return Response.json({ token_endpoint: 'https://idp/oauth/token' });
			}
			calls.push(String(init?.body));
			n++;
			return Response.json({ access_token: `a${n}`, expires_in: 600, refresh_token: `r${n + 1}` });
		}) as unknown as typeof globalThis.fetch;
		const ensureFresh = createRefresher({ issuer: 'https://idp', clientId: 'd', rolesClaim: 'g', fetch, now: () => now });
		// WS bridge refreshes r1 → r2, but the browser never gets the cookie.
		expect((await ensureFresh(expiring))?.refreshToken).toBe('r2');
		// 20 min later the browser still sends r1; r2's token has expired.
		now += 20 * 60 * 1000;
		const r = await ensureFresh(expiring);
		expect(r).toMatchObject({ accessToken: 'a2', refreshToken: 'r3' });
		expect(calls.map((b) => /refresh_token=(r\d)/.exec(b)?.[1])).toEqual(['r1', 'r2']);
	});
});
