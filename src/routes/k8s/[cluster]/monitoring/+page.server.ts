import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isNamespaceName } from '$lib/k8s-names';
import { requireRead, accessibleNamespaces } from '$lib/authz';
import { core, metrics } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { withDeadline } from '$lib';
import { summarize, type PodIn, type PodMetricsIn } from '$lib/namespace-usage.server';

// Resource usage per namespace (and per pod for a single namespace):
// CPU/memory actual vs requests/limits, restarts, failing pods, OOMs.
// Scoped to what the session may read — namespace-only users see their
// own namespaces. Usage needs metrics-server; without it only the
// spec/status side is shown.
const DEADLINE_MS = 8_000;

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const session = await locals.auth();
	const cluster = params.cluster;
	requireRead(session, cluster, undefined, { forCluster: true });

	const ns = url.searchParams.get('ns') || '';
	if (ns && !isNamespaceName(ns)) throw error(400, 'invalid namespace');
	if (ns) requireRead(session, cluster, ns);
	const accessible = accessibleNamespaces(session, cluster);
	// null = every namespace (cluster-wide reader, nothing selected)
	const scope: string[] | null = ns ? [ns] : accessible === 'all' ? null : accessible;

	// Each namespace is fetched on its own (settled, not fail-fast): one
	// missing or failing namespace doesn't blank the others.
	const errors: string[] = [];
	const settle = async <T>(label: string, p: Promise<T>): Promise<T | null> => {
		try {
			return await withDeadline(p, DEADLINE_MS, label);
		} catch (err) {
			errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
			return null;
		}
	};
	const quiet = async <T>(p: Promise<T>): Promise<T | null> =>
		withDeadline(p, DEADLINE_MS, 'metrics').catch(() => null);

	const targets: Array<string | null> = scope === null ? [null] : scope;
	const results = await Promise.all(
		targets.map(async (n) => {
			const [podList, metricList] = await Promise.all([
				settle(
					n ?? 'all namespaces',
					n === null
						? time(`${cluster}/listPodForAllNamespaces`, () => core(cluster).listPodForAllNamespaces())
						: time(`${cluster}/listNamespacedPod`, () => core(cluster).listNamespacedPod({ namespace: n }))
				),
				// metrics-server is optional; its absence isn't an error.
				quiet(n === null ? metrics(cluster).getPodMetrics() : metrics(cluster).getPodMetrics(n))
			]);
			return { pods: (podList?.items ?? []) as PodIn[], metrics: (metricList?.items ?? null) as PodMetricsIn[] | null };
		})
	);
	const pods = results.flatMap((r) => r.pods);
	const anyMetrics = results.some((r) => r.metrics !== null);
	const podMetrics = anyMetrics ? results.flatMap((r) => r.metrics ?? []) : null;
	const metricsAvailable = anyMetrics;
	const loadError = errors.length ? errors.join('; ') : null;

	const { namespaces, pods: podRows } = summarize(pods, podMetrics, Date.now());
	return {
		cluster,
		scopedNs: ns,
		namespaces,
		// Per-pod detail only when one namespace is in view.
		pods: namespaces.length === 1 ? podRows : [],
		metricsAvailable,
		error: loadError
	};
};
