// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { csrfHandle, readJson } from './csrf.server';

function run(method: string, path: string, origin?: string) {
	const url = new URL(`http://dash.example${path}`);
	const headers = origin ? { origin } : undefined;
	const resolve = vi.fn(async () => new Response('ok'));
	const event = { url, request: new Request(url, { method, headers }) };
	return { p: csrfHandle({ event, resolve } as never), resolve };
}

describe('csrfHandle', () => {
	it('rejects a cross-origin POST', () => {
		expect(() => run('POST', '/k8s/local/api/scale', 'https://evil.example').p).toThrow(
			expect.objectContaining({ status: 403 })
		);
	});

	it('rejects a same-site sibling subdomain', () => {
		expect(() => run('POST', '/k8s/local/api/scale', 'https://blog.dash.example').p).toThrow();
	});

	it('allows same-host POST even if the scheme differs (tunnel)', async () => {
		const { resolve } = run('POST', '/k8s/local/api/scale', 'https://dash.example');
		expect(resolve).toHaveBeenCalled();
	});

	it('allows a POST with no Origin header', () => {
		expect(run('POST', '/k8s/local/api/scale').resolve).toHaveBeenCalled();
	});

	it('ignores GET and the OIDC callback', () => {
		expect(run('GET', '/k8s/local', 'https://evil.example').resolve).toHaveBeenCalled();
		expect(run('POST', '/auth/callback/zitadel', 'https://id.example').resolve).toHaveBeenCalled();
	});
});

describe('readJson', () => {
	it('throws 400 on a malformed body', async () => {
		const req = new Request('http://x', { method: 'POST', body: '{nope' });
		await expect(readJson(req)).rejects.toMatchObject({ status: 400 });
	});

	it('parses valid JSON', async () => {
		const req = new Request('http://x', { method: 'POST', body: '{"a":1}' });
		await expect(readJson(req)).resolves.toEqual({ a: 1 });
	});
});
