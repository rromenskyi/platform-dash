// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkTarget, blockModeFrom } from './http-target.server';

const dns = (map: Record<string, string[]>) => async (h: string) =>
	(map[h] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const u = (s: string) => new URL(s);

describe('blockModeFrom', () => {
	it('defaults to metadata', () => {
		expect(blockModeFrom(undefined)).toBe('metadata');
		expect(blockModeFrom('bogus')).toBe('metadata');
		expect(blockModeFrom('none')).toBe('none');
		expect(blockModeFrom('private')).toBe('private');
	});
});

describe('checkTarget', () => {
	it('metadata mode blocks link-local, loopback and mapped forms', async () => {
		for (const t of [
			'http://169.254.169.254/latest/meta-data/',
			'http://127.0.0.1:3000/',
			'http://[::1]/',
			'http://[::ffff:169.254.169.254]/'
		]) {
			expect(await checkTarget(u(t), 'metadata')).toMatch(/blocked/);
		}
	});

	it('metadata mode blocks a hostname resolving to metadata', async () => {
		const r = dns({ 'evil.example': ['93.184.216.34', '169.254.169.254'] });
		expect(await checkTarget(u('http://evil.example/'), 'metadata', r)).toMatch(/169\.254/);
	});

	it('metadata mode allows internal services', async () => {
		const r = dns({ 'grafana.monitoring.svc': ['10.43.0.10'] });
		expect(await checkTarget(u('http://grafana.monitoring.svc/'), 'metadata', r)).toBeNull();
		expect(await checkTarget(u('http://10.42.1.5:8080/'), 'metadata')).toBeNull();
	});

	it('private mode blocks RFC1918 and cluster names', async () => {
		expect(await checkTarget(u('http://10.42.1.5/'), 'private')).toMatch(/blocked/);
		expect(await checkTarget(u('http://192.168.1.1/'), 'private')).toMatch(/blocked/);
		expect(await checkTarget(u('http://kubernetes.default.svc/'), 'private')).toMatch(/in-cluster/);
		expect(await checkTarget(u('http://x.ns.svc.cluster.local/'), 'private')).toMatch(/in-cluster/);
	});

	it('allows public targets in every mode and anything in none', async () => {
		const r = dns({ 'example.com': ['93.184.216.34'] });
		expect(await checkTarget(u('https://example.com/'), 'private', r)).toBeNull();
		expect(await checkTarget(u('http://169.254.169.254/'), 'none')).toBeNull();
	});
});
