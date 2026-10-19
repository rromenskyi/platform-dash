// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('./k8s.server', () => ({ core: () => ({}) }));
vi.mock('./k8s-metrics.server', () => ({ time: (_l: string, fn: () => unknown) => fn() }));
const { makeRedactor, NODE_PLACEHOLDER: N } = await import('./node-redact.server');

describe('makeRedactor', () => {
	const r = makeRedactor(['worker-10', 'worker-1', 'km1'], new Set(['10.0.0.5']));

	it('replaces node names and addresses as whole tokens', () => {
		expect(r.text('Successfully assigned a/p to worker-1')).toBe(`Successfully assigned a/p to ${N}`);
		expect(r.text('on worker-10 and worker-1.')).toBe(`on ${N} and ${N}.`);
		expect(r.text('probe to 10.0.0.5:8080 failed')).toBe(`probe to ${N}:8080 failed`);
		expect(r.text('pod worker-1x is not a node')).toBe('pod worker-1x is not a node');
		expect(r.text('ip 10.0.0.55 is not a node')).toBe('ip 10.0.0.55 is not a node');
	});

	it('hides the node count in scheduler messages', () => {
		expect(r.text('0/7 nodes are available: 3 Insufficient cpu.')).toBe(
			'no nodes are available: 3 Insufficient cpu.'
		);
	});

	it('drops node addresses but keeps other IPs', () => {
		expect(r.ip('10.0.0.5')).toBeUndefined();
		expect(r.ip('100.72.3.130')).toBe('100.72.3.130');
	});
});
