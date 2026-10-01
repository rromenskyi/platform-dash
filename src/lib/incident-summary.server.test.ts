// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const failingPod = { status: { phase: 'Failed' } };
vi.mock('./k8s.server', () => ({
	core: () => ({
		listPodForAllNamespaces: async () => ({ items: [failingPod] }),
		listNode: async () => ({ items: [] })
	})
}));
vi.mock('./clusters.server', () => ({ listClusters: () => ['a', 'b'] }));
vi.mock('./k8s-metrics.server', () => ({ time: (_l: string, fn: () => unknown) => fn() }));

const { incidentSummary } = await import('./incident-summary.server');

describe('incidentSummary shared cache', () => {
	it("isn't narrowed by whichever session triggered the refresh", async () => {
		// An ns-only session (no readable clusters) warms the cache first.
		expect(incidentSummary(() => false)).toBeNull();
		await new Promise((r) => setTimeout(r, 0));
		// An admin then reads it and still sees every cluster.
		const admin = incidentSummary(() => true);
		expect(admin?.perCluster.map((c) => c.cluster)).toEqual(['a', 'b']);
		expect(admin?.totalFailing).toBe(2);
		// And a cluster-scoped reader only sees their cluster.
		expect(incidentSummary((c) => c === 'a')?.perCluster.map((c) => c.cluster)).toEqual(['a']);
	});
});
