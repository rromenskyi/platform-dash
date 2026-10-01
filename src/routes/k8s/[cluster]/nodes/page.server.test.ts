// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const listNamespacedPod = vi.fn(async () => ({ items: [] }));
const node = (name: string) => ({ metadata: { name }, status: {}, spec: {} });
const summaries: Record<string, unknown> = {
	a: JSON.stringify({
		node: {
			fs: { usedBytes: 60, capacityBytes: 100 },
			runtime: { imageFs: { usedBytes: 30, capacityBytes: 100 } }
		}
	}),
	b: { node: { fs: { usedBytes: 9, capacityBytes: 10 }, runtime: { imageFs: { usedBytes: 1, capacityBytes: 50 } } } }
};

vi.mock('$lib/k8s.server', () => ({
	core: () => ({
		listNode: async () => ({ items: [node('a'), node('b'), node('c')] }),
		listNamespacedPod,
		listPodForAllNamespaces: async () => ({ items: [] }),
		connectGetNodeProxyWithPath: async ({ name }: { name: string }) => {
			if (!(name in summaries)) throw new Error('kubelet unreachable');
			return summaries[name];
		}
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

describe('nodes loader authz', () => {
	it('denies namespace-only operators, even for their own namespace', async () => {
		for (const q of ['', 'ns=team-a', 'ns=team-b']) {
			await expect(load(event(['namespace_team-a_sre'], q))).rejects.toMatchObject({
				status: 403
			});
		}
		expect(listNamespacedPod).not.toHaveBeenCalled();
	});

	it('allows cluster-wide readers', async () => {
		await expect(load(event(['cluster_local_sre'], 'ns=team-b'))).resolves.toBeTruthy();
	});
});

describe('nodes loader disk usage', () => {
	it('reads kubelet fs stats, skipping a shared imagefs and unreachable kubelets', async () => {
		const data = (await load(event(['platform_sre'], ''))) as {
			rows: Array<{ name: string; usage: { disk?: unknown; imageDisk?: unknown } }>;
		};
		const by = Object.fromEntries(data.rows.map((r) => [r.name, r.usage]));
		expect(by.a.disk).toEqual({ usedBytes: 60, capacityBytes: 100 });
		expect(by.a.imageDisk).toBeUndefined(); // same capacity ⇒ same fs
		expect(by.b.imageDisk).toEqual({ usedBytes: 1, capacityBytes: 50 });
		expect(by.c.disk).toBeUndefined(); // kubelet down ⇒ no bar, page still loads
	});
});
