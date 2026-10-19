// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { summarize, type PodIn } from './namespace-usage.server';
import { parseCpuMilli, parseMemBytes, fmtBytes, fmtCpu } from './quantity';

const NOW = new Date('2026-10-19T12:00:00Z').getTime();

const pod = (ns: string, name: string, extra: Partial<PodIn> = {}): PodIn => ({
	metadata: { namespace: ns, name },
	spec: {
		containers: [
			{ name: 'app', resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } } }
		]
	},
	status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: true, restartCount: 0 }] },
	...extra
});

describe('quantity', () => {
	it('parses and formats', () => {
		expect(parseCpuMilli('139403626n')).toBeCloseTo(139.4, 1);
		expect(parseCpuMilli('2')).toBe(2000);
		expect(parseMemBytes('128Mi')).toBe(128 * 1024 ** 2);
		expect(parseMemBytes('1G')).toBe(1e9);
		expect(fmtCpu(250)).toBe('250m');
		expect(fmtCpu(1500)).toBe('1.50 cores');
		expect(fmtBytes(128 * 1024 ** 2)).toBe('128 Mi');
	});
});

describe('summarize', () => {
	it('rolls pods up per namespace with usage, requests and limits', () => {
		const { namespaces, pods } = summarize(
			[pod('a', 'p1'), pod('a', 'p2'), pod('b', 'q1')],
			[
				{ metadata: { namespace: 'a', name: 'p1' }, containers: [{ usage: { cpu: '50000000n', memory: '100Mi' } }] },
				{ metadata: { namespace: 'a', name: 'p2' }, containers: [{ usage: { cpu: '25m', memory: '50Mi' } }] }
			],
			NOW
		);
		expect(namespaces.map((n) => n.namespace)).toEqual(['a', 'b']);
		const a = namespaces[0];
		expect(a).toMatchObject({ pods: 2, running: 2, failing: 0, cpuRequestMilli: 200, cpuLimitMilli: 2000 });
		expect(a.cpuUsedMilli).toBeCloseTo(75);
		expect(a.memUsedBytes).toBe(150 * 1024 ** 2);
		expect(namespaces[1].cpuUsedMilli).toBeNull(); // no metrics for b
		expect(pods).toHaveLength(3);
	});

	it('counts restarts, failing pods and recent OOMs; finished pods hold no resources', () => {
		const crash = pod('a', 'crash', {
			status: {
				phase: 'Running',
				containerStatuses: [
					{
						name: 'app',
						ready: false,
						restartCount: 7,
						lastState: { terminated: { reason: 'OOMKilled', finishedAt: new Date(NOW - 3600_000).toISOString() } }
					}
				]
			}
		});
		const oldOom = pod('a', 'old', {
			status: {
				phase: 'Running',
				containerStatuses: [
					{ name: 'app', ready: true, restartCount: 1, lastState: { terminated: { reason: 'OOMKilled', finishedAt: new Date(NOW - 3 * 86400_000).toISOString() } } }
				]
			}
		});
		const job = pod('a', 'job', { status: { phase: 'Succeeded', containerStatuses: [] } });
		const { namespaces, pods } = summarize([crash, oldOom, job], null, NOW);
		expect(namespaces[0]).toMatchObject({ pods: 3, running: 2, failing: 1, restarts: 8, oom24h: 1, cpuRequestMilli: 200 });
		expect(pods[0]).toMatchObject({ name: 'crash', failing: true, lastTermination: 'OOMKilled' });
	});

	it('reports a limit only when every active container has one', () => {
		const unlimited = pod('a', 'u', {
			spec: { containers: [{ name: 'app', resources: { requests: { cpu: '50m', memory: '64Mi' } } }] }
		});
		const { namespaces, pods } = summarize([pod('a', 'p1'), unlimited], null, NOW);
		expect(namespaces[0]).toMatchObject({ cpuLimitMilli: 0, memLimitBytes: 0, cpuRequestMilli: 150 });
		expect(pods.find((p) => p.name === 'p1')).toMatchObject({ cpuLimitMilli: 1000, memLimitBytes: 512 * 1024 ** 2 });
		expect(pods.find((p) => p.name === 'u')).toMatchObject({ cpuLimitMilli: 0, memLimitBytes: 0 });
	});
});
