// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A real upstream on loopback: echoes method/path/headers/body, and has
// a redirect and a slow route.
let upstreamUrl = '';
const server = http.createServer((req, res) => {
	if (req.url?.startsWith('/redir')) {
		res.writeHead(302, { location: '/ui/next', 'set-cookie': 'p=1' });
		return res.end();
	}
	if (req.url?.startsWith('/slow')) return; // never answers
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'plugin=1', 'x-internal': 'leak' });
		res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
	});
});

const token = { value: 'acc-123' as string | null };
vi.mock('$lib/session-token.server', () => ({ currentAccessToken: async () => token.value }));
vi.mock('$env/dynamic/private', () => ({
	env: {
		get DASH_PLUGINS_JSON() {
			return JSON.stringify([
				{ id: 'web', title: 'Web', element: 'x-app', url: upstreamUrl },
				{ id: 'adm', title: 'Admin', element: 'x-adm', url: upstreamUrl, roles: ['platform_admin'] }
			]);
		}
	}
}));

const { fallback } = await import('./+server');

beforeAll(async () => {
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	upstreamUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

function call(
	id: string,
	path: string,
	init: RequestInit & { roles?: string[]; anon?: boolean } = {}
) {
	const url = new URL(`http://dash.test/plugin-api/${id}/${path}`);
	const request = new Request(url, init);
	const session = init.anon ? null : { user: { email: 'u@x' }, roles: init.roles ?? [] };
	return fallback({
		params: { id, path: path.split('?')[0] },
		request,
		url,
		locals: { auth: async () => session },
		getClientAddress: () => '203.0.113.9'
	} as never);
}

describe('plugin API proxy', () => {
	it('forwards the bearer token and allow-listed headers, never cookies', async () => {
		const res = await call('web', 'api/echo?x=1', {
			headers: { cookie: 'authjs.session-token=secret', accept: 'application/json', 'x-evil': '1' }
		});
		expect(res.status).toBe(200);
		const echo = await res.json();
		expect(echo.url).toBe('/api/echo?x=1');
		expect(echo.headers.authorization).toBe('Bearer acc-123');
		expect(echo.headers.cookie).toBeUndefined();
		expect(echo.headers['x-evil']).toBeUndefined();
		expect(echo.headers.accept).toBe('application/json');
		expect(echo.headers['x-forwarded-prefix']).toBe('/plugin-api/web');
		expect(echo.headers['x-forwarded-for']).toBe('203.0.113.9');
		// Response: plugin cookies and unknown headers stripped.
		expect(res.headers.get('set-cookie')).toBeNull();
		expect(res.headers.get('x-internal')).toBeNull();
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('passes method and body', async () => {
		const res = await call('web', 'v1/apps', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"a":1}'
		});
		expect(await res.json()).toMatchObject({ method: 'POST', body: '{"a":1}' });
	});

	it('rewrites plugin redirects under the proxy prefix', async () => {
		const res = await call('web', 'redir');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/plugin-api/web/ui/next');
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	it('401 session_expired without a session or usable token', async () => {
		let res = await call('web', 'x', { anon: true });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'session_expired' });
		token.value = null;
		res = await call('web', 'x');
		expect(res.status).toBe(401);
		token.value = 'acc-123';
	});

	it('enforces plugin roles, unknown ids and dot segments', async () => {
		expect((await call('adm', 'x', { roles: ['platform_sre'] })).status).toBe(403);
		expect((await call('adm', 'api/echo', { roles: ['platform_admin'] })).status).toBe(200);
		expect((await call('nope', 'x')).status).toBe(404);
		expect((await call('web', 'a/../../etc')).status).toBe(400);
	});

	it('rejects oversized bodies', async () => {
		const res = await call('web', 'x', {
			method: 'POST',
			headers: { 'content-length': String(11 * 1024 * 1024) },
			body: 'x'
		});
		expect(res.status).toBe(413);
	});

	it('502 when the plugin is unreachable', async () => {
		const saved = upstreamUrl;
		upstreamUrl = 'http://127.0.0.1:1';
		const res = await call('web', 'x');
		upstreamUrl = saved;
		expect(res.status).toBe(502);
	});
});
