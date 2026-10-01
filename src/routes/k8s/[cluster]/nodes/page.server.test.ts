// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const listNamespacedPod = vi.fn(async () => ({ items: [] }));

vi.mock('$lib/k8s.server', () => ({
	core: () => ({
		listNode: async () => ({ items: [] }),
		listNamespacedPod,
		listPodForAllNamespaces: async () => ({ items: [] })
	}),
	metrics: () => ({ getNodeMetrics: async () => null })
}));
vi.mock('$lib/k8s-metrics.server', () => ({ time: (_l: string, fn: () => unknown) => fn() }));

const { load } = await import('./+page.server');

function event(roles: string[], query: string) {
	return {
		params: { cluster: 'local' },
		url: new URL(`http://x/k8s/local/nodes?${query}`),
		locals: { auth: async () => ({ user: { email: 'u@x' }, roles }) }
	} as unknown as Parameters<typeof load>[0];
}

describe('nodes loader ?ns= authz', () => {
	it('denies a namespace reader usage sums for another namespace', async () => {
		await expect(load(event(['namespace_team-a_sre'], 'ns=team-b'))).rejects.toMatchObject({
			status: 403
		});
		expect(listNamespacedPod).not.toHaveBeenCalled();
	});

	it('allows their own namespace', async () => {
		await expect(load(event(['namespace_team-a_sre'], 'ns=team-a'))).resolves.toBeTruthy();
	});
});
