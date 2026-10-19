// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
const { parsePlugins, canUsePlugin } = await import('./plugins.server');

const good = { id: 'proj', title: 'Projects', element: 'x-app', url: 'http://svc:8080/' };

describe('parsePlugins', () => {
	it('returns nothing when unset', () => {
		expect(parsePlugins(undefined)).toEqual([]);
		expect(parsePlugins('  ')).toEqual([]);
	});

	it('parses a valid entry, trims the url and defaults roles', () => {
		expect(parsePlugins(JSON.stringify([good]))).toEqual([
			{ id: 'proj', title: 'Projects', icon: undefined, element: 'x-app', url: 'http://svc:8080', roles: [] }
		]);
	});

	it('skips invalid entries with a reason and keeps the rest', () => {
		const log = vi.fn();
		const out = parsePlugins(
			JSON.stringify([
				{ ...good, id: 'Bad/Id' },
				{ ...good, element: 'noHyphen' },
				{ ...good, url: 'file:///etc/passwd' },
				{ ...good, title: '' },
				{ ...good, url: 'http://user:pw@svc' },
				good,
				{ ...good } // duplicate id
			]),
			log
		);
		expect(out.map((p) => p.id)).toEqual(['proj']);
		expect(log).toHaveBeenCalledTimes(6);
		expect(log.mock.calls.map((c) => c[0]).join('\n')).toMatch(/\[2\]: url must be http\(s\)/);
	});

	it('disables plugins on malformed JSON instead of throwing', () => {
		const log = vi.fn();
		expect(parsePlugins('[{', log)).toEqual([]);
		expect(parsePlugins('{"id":"x"}', log)).toEqual([]);
		expect(log).toHaveBeenCalledTimes(2);
	});
});

describe('roles fail closed', () => {
	it('skips an entry whose roles is not a list of names', () => {
		const log = vi.fn();
		const out = parsePlugins(
			JSON.stringify([
				{ ...good, id: 'a', roles: 'platform_admin' },
				{ ...good, id: 'b', roles: [1] },
				{ ...good, id: 'c', roles: [''] },
				{ ...good, id: 'd', roles: [] }
			]),
			log
		);
		expect(out.map((p) => p.id)).toEqual(['d']);
		expect(log).toHaveBeenCalledTimes(3);
	});
});

describe('rewriteLocation', () => {
	it('maps plugin locations under the proxy prefix, honouring a url path', async () => {
		const { rewriteLocation } = await import('./plugins.server');
		const b = '/plugin-api/x';
		expect(rewriteLocation('/login', 'http://svc:8080', b)).toBe('/plugin-api/x/login');
		expect(rewriteLocation('http://svc:8080/a?q=1', 'http://svc:8080', b)).toBe('/plugin-api/x/a?q=1');
		expect(rewriteLocation('/app/login', 'http://svc/app', b)).toBe('/plugin-api/x/login');
		expect(rewriteLocation('http://svc/app/login', 'http://svc/app', b)).toBe('/plugin-api/x/login');
		expect(rewriteLocation('//evil.example/x', 'http://svc', b)).toBe('/plugin-api/x/evil.example/x');
		expect(rewriteLocation('https://idp.example/auth', 'http://svc', b)).toBe('https://idp.example/auth');
		expect(rewriteLocation('next', 'http://svc', b)).toBe('next');
	});
});

describe('canUsePlugin', () => {
	const p = parsePlugins(JSON.stringify([{ ...good, roles: ['platform_admin'] }, { ...good, id: 'open' }]));
	const s = (roles: string[]) => ({ user: { email: 'u@x' }, roles, expires: '' });

	it('empty roles = any signed-in user, never anonymous', () => {
		expect(canUsePlugin(s(['namespace_t-a_admin']), p[1])).toBe(true);
		expect(canUsePlugin(null, p[1])).toBe(false);
	});

	it('requires one of the listed roles', () => {
		expect(canUsePlugin(s(['platform_admin']), p[0])).toBe(true);
		expect(canUsePlugin(s(['platform_sre']), p[0])).toBe(false);
	});
});
