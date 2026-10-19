import type { PageServerLoad } from './$types';
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
	if (ns) requireRead(session, cluster, ns);
	const accessible = accessibleNamespaces(session, cluster);
	// null = every namespace (cluster-wide reader, nothing selected)
	const scope: string[] | null = ns ? [ns] : accessible === 'all' ? null : accessible;

	let error: string | null = null;
	let metricsAvailable = true;
	let pods: PodIn[] = [];
	let podMetrics: PodMetricsIn[] | null = null;
	try {
		const listPods = () =>
			scope === null
				? time(`${cluster}/listPodForAllNamespaces`, () => core(cluster).listPodForAllNamespaces()).then((r) => r.items)
				: Promise.all(
						scope.map((n) =>
							time(`${cluster}/listNamespacedPod`, () => core(cluster).listNamespacedPod({ namespace: n })).then(
								(r) => r.items
							)
						)
					).then((l) => l.flat());
		const listMetrics = () =>
			(scope === null
				? metrics(cluster).getPodMetrics().then((r) => r.items)
				: Promise.all(scope.map((n) => metrics(cluster).getPodMetrics(n).then((r) => r.items))).then((l) => l.flat())
			).catch(() => null); // metrics-server missing or down
		const [p, m] = await Promise.all([
			withDeadline(listPods(), DEADLINE_MS, `${cluster} pods`),
			withDeadline(listMetrics(), DEADLINE_MS, `${cluster} pod metrics`).catch(() => null)
		]);
		pods = p as PodIn[];
		podMetrics = m as PodMetricsIn[] | null;
		metricsAvailable = podMetrics !== null;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}

	const { namespaces, pods: podRows } = summarize(pods, podMetrics, Date.now());
	return {
		cluster,
		scopedNs: ns,
		namespaces,
		// Per-pod detail only when one namespace is in view.
		pods: namespaces.length === 1 ? podRows : [],
		metricsAvailable,
		error
	};
};
