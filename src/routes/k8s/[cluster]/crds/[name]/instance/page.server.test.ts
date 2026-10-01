// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const crd = { spec: { group: 'g.io', names: { plural: 'things', kind: 'Thing' }, scope: 'Namespaced', versions: [{ name: 'v1', served: true, storage: true }] } };
const getNamespaced = vi.fn(async () => ({ metadata: { name: 'x' } }));
const getCluster = vi.fn(async () => ({ metadata: { name: 'x' } }));

vi.mock('$lib/k8s.server', () => ({
	apiextensions: () => ({ readCustomResourceDefinition: async () => crd }),
	customObjects: () => ({
		getNamespacedCustomObject: getNamespaced,
		getClusterCustomObject: getCluster
	})
}));
vi.mock('$lib/k8s-metrics.server', () => ({ time: (_l: string, fn: () => unknown) => fn() }));

const { load } = await import('./+page.server');

function event(roles: string[], query: string) {
	return {
		params: { cluster: 'local', name: 'things.g.io' },
		url: new URL(`http://x/k8s/local/crds/things.g.io/instance?${query}`),
		locals: { auth: async () => ({ user: { email: 'u@x' }, roles }) }
	} as unknown as Parameters<typeof load>[0];
}

const nsOnly = ['namespace_team-a_sre'];

describe('CRD instance loader authz', () => {
	beforeEach(() => {
		crd.spec.scope = 'Namespaced';
		getNamespaced.mockClear();
		getCluster.mockClear();
	});

	it('lets a namespace reader open an instance in their namespace', async () => {
		await expect(load(event(nsOnly, 'ns=team-a&n=x'))).resolves.toBeTruthy();
		expect(getNamespaced).toHaveBeenCalledOnce();
	});

	it('denies a namespace reader an instance in another namespace', async () => {
		await expect(load(event(nsOnly, 'ns=kube-system&n=x'))).rejects.toMatchObject({ status: 403 });
		expect(getNamespaced).not.toHaveBeenCalled();
	});

	it('denies a namespace reader a cluster-scoped instance', async () => {
		crd.spec.scope = 'Cluster';
		await expect(load(event(nsOnly, 'n=x'))).rejects.toMatchObject({ status: 403 });
		expect(getCluster).not.toHaveBeenCalled();
	});

	it('lets a cluster-wide reader open a cluster-scoped instance', async () => {
		crd.spec.scope = 'Cluster';
		await expect(load(event(['platform_sre'], 'n=x'))).resolves.toBeTruthy();
	});
});
