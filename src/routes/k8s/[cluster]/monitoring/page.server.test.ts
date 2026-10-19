// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const pod = (ns: string, name: string) => ({
	metadata: { namespace: ns, name },
	spec: { containers: [] },
	status: { phase: 'Running', containerStatuses: [] }
});
const listNamespacedPod = vi.fn(async ({ namespace }: { namespace: string }) => {
	if (namespace === 'gone') throw new Error('namespaces "gone" not found');
	return { items: [pod(namespace, 'p')] };
});
const listPodForAllNamespaces = vi.fn(async () => ({ items: [pod('a', 'p'), pod('b', 'p')] }));

vi.mock('$lib/k8s.server', () => ({
	core: () => ({ listNamespacedPod, listPodForAllNamespaces }),
	metrics: () => ({ getPodMetrics: async () => ({ items: [] }) })
}));
vi.mock('$lib/k8s-metrics.server', () => ({ time: (_l: string, fn: () => unknown) => fn() }));

const { load } = await import('./+page.server');

const event = (roles: string[], query = '') =>
	({
		params: { cluster: 'local' },
		url: new URL(`http://x/k8s/local/monitoring?${query}`),
		locals: { auth: async () => ({ user: { email: 'u@x' }, roles }) }
	}) as unknown as Parameters<typeof load>[0];

describe('monitoring loader scope', () => {
	it('namespace-only users get exactly their namespaces', async () => {
		const data = (await load(event(['namespace_a_admin', 'namespace_c_sre']))) as { namespaces: { namespace: string }[] };
		expect(listPodForAllNamespaces).not.toHaveBeenCalled();
		expect(listNamespacedPod.mock.calls.map((c) => c[0].namespace).sort()).toEqual(['a', 'c']);
		expect(data.namespaces.map((n) => n.namespace)).toEqual(['a', 'c']);
	});

	it("can't select a namespace outside the role", async () => {
		await expect(load(event(['namespace_a_admin'], 'ns=b'))).rejects.toMatchObject({ status: 403 });
	});

	it('cluster-wide readers see every namespace, pods only for a single one', async () => {
		const all = (await load(event(['platform_sre']))) as { namespaces: unknown[]; pods: unknown[] };
		expect(all.namespaces).toHaveLength(2);
		expect(all.pods).toHaveLength(0);
		const one = (await load(event(['platform_sre'], 'ns=b'))) as { pods: unknown[] };
		expect(one.pods).toHaveLength(1);
	});

	it('signed-in users without roles are refused; anonymous ones sent to sign in', async () => {
		await expect(load(event([]))).rejects.toMatchObject({ status: 403 });
		const anon = { ...event([]), locals: { auth: async () => null } } as unknown as Parameters<typeof load>[0];
		await expect(load(anon)).rejects.toMatchObject({ status: 303 });
	});

	it('keeps the namespaces that loaded when one fails', async () => {
		const data = (await load(event(['namespace_a_admin', 'namespace_gone_admin']))) as {
			namespaces: { namespace: string }[];
			error: string | null;
		};
		expect(data.namespaces.map((n) => n.namespace)).toEqual(['a']);
		expect(data.error).toMatch(/gone/);
	});

	it('rejects a malformed ?ns=', async () => {
		await expect(load(event(['platform_sre'], 'ns=Bad_NS'))).rejects.toMatchObject({ status: 400 });
	});
});
