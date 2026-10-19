// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const ev = (ns: string, kind: string, name: string, message: string) => ({
	metadata: { namespace: ns, name: `${name}.1` },
	involvedObject: { kind, name, namespace: ns },
	type: 'Normal',
	reason: 'Scheduled',
	message
});

vi.mock('$lib/k8s.server', () => ({
	core: () => ({
		listEventForAllNamespaces: async () => ({
			items: [
				ev('a', 'Pod', 'p', 'Successfully assigned a/p to worker-7'),
				ev('a', 'Node', 'worker-7', 'Node worker-7 status is now: NodeReady'),
				ev('b', 'Pod', 'q', 'other tenant')
			]
		}),
		listNamespacedEvent: async () => ({ items: [] }),
		listNode: async () => ({
			items: [{ metadata: { name: 'worker-7' }, status: { addresses: [{ type: 'InternalIP', address: '10.1.2.3' }] } }]
		})
	})
}));
vi.mock('$lib/k8s-metrics.server', () => ({ time: (_l: string, fn: () => unknown) => fn() }));

const { load } = await import('./+page.server');
const event = (roles: string[]) =>
	({
		params: { cluster: 'local' },
		url: new URL('http://x/k8s/local/events'),
		locals: { auth: async () => ({ user: { email: 'u@x' }, roles }) }
	}) as never;

describe('events for namespace-scoped users', () => {
	it('drops Node events and other namespaces, scrubs node names', async () => {
		const d = (await load(event(['namespace_a_sre']))) as { rows: Array<{ involved: string; message: string }> };
		expect(d.rows.map((r) => r.involved)).toEqual(['Pod/p']);
		expect(d.rows[0].message).toBe('Successfully assigned a/p to ‹node›');
	});

	it('leaves everything for cluster-wide readers', async () => {
		const d = (await load(event(['platform_sre']))) as { rows: Array<{ message: string }> };
		expect(d.rows).toHaveLength(3);
		expect(d.rows.some((r) => r.message.includes('worker-7'))).toBe(true);
	});
});
