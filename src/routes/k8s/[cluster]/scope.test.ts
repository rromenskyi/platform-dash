// @vitest-environment node
// Namespace-scoped sessions must not receive cluster-level details
// (nodes, CRD definitions) from the overview, workloads or CRD pages.
import { describe, it, expect, vi } from 'vitest';

const pod = (ns: string) => ({
	metadata: { namespace: ns, name: `p-${ns}` },
	spec: { nodeName: 'node-1', containers: [{ name: 'c', image: 'i' }] },
	status: { phase: 'Running', containerStatuses: [] }
});
const items = <T>(x: T[]) => ({ items: x });

vi.mock('$lib/k8s.server', () => ({
	core: () => ({
		listNode: async () => items([{ metadata: { name: 'node-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }]),
		listNamespace: async () => items([{ metadata: { name: 'a' } }, { metadata: { name: 'b' } }]),
		listPodForAllNamespaces: async () => items([pod('a'), pod('b')]),
		listNamespacedPod: async ({ namespace }: { namespace: string }) => items([pod(namespace)])
	}),
	apps: () => ({
		listDeploymentForAllNamespaces: async () => items([]),
		listNamespacedDeployment: async () => items([]),
		listStatefulSetForAllNamespaces: async () => items([]),
		listNamespacedStatefulSet: async () => items([])
	}),
	apiextensions: () => ({ listCustomResourceDefinition: async () => items([{ metadata: { name: 'x.io' } }]) }),
	metrics: () => ({ getPodMetrics: async () => items([]) })
}));
vi.mock('$lib/k8s-metrics.server', () => ({ time: (_l: string, fn: () => unknown) => fn() }));

const overview = (await import('./+page.server')).load;
const workloads = (await import('./workloads/+page.server')).load;
const crds = (await import('./crds/+page.server')).load;

const event = (roles: string[], path = '', query = '') =>
	({
		params: { cluster: 'local' },
		url: new URL(`http://x/k8s/local${path}?${query}`),
		locals: { auth: async () => ({ user: { email: 'u@x' }, roles }) }
	}) as never;

const nsOnly = ['namespace_a_admin'];

describe('cluster-level details for namespace-scoped users', () => {
	it('overview omits node and CRD counts', async () => {
		const d = (await overview(event(nsOnly))) as { summary: { nodes: unknown; crds: unknown }; clusterWide: boolean };
		expect(d.clusterWide).toBe(false);
		expect(d.summary.nodes).toBeNull();
		expect(d.summary.crds).toBeNull();
		const admin = (await overview(event(['platform_sre']))) as { summary: { nodes: unknown; crds: unknown } };
		expect(admin.summary.nodes).toEqual({ ready: 1, total: 1 });
		expect(admin.summary.crds).toBe(1);
	});

	it('workloads drop node names', async () => {
		const d = (await workloads(event(nsOnly, '/workloads'))) as { rows: Array<{ kind: string; node?: string; namespace: string }> };
		const pods = d.rows.filter((r) => r.kind === 'Pod');
		expect(pods.map((r) => r.namespace)).toEqual(['a']);
		expect(pods.every((r) => r.node === undefined)).toBe(true);
		const admin = (await workloads(event(['platform_sre'], '/workloads'))) as { rows: Array<{ kind: string; node?: string }> };
		expect(admin.rows.filter((r) => r.kind === 'Pod').every((r) => r.node === 'node-1')).toBe(true);
	});

	it('CRD definitions need cluster-wide read', async () => {
		await expect(crds(event(nsOnly, '/crds'))).rejects.toMatchObject({ status: 403 });
		await expect(crds(event(['platform_sre'], '/crds'))).resolves.toBeTruthy();
	});
});
