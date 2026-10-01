import type { RequestHandler } from './$types';
import { core } from '$lib/k8s.server';
import { defaultCluster, listClusters } from '$lib/clusters.server';
import { time } from '$lib/k8s-metrics.server';

// Readiness probe — pod is "ready" only when *every* configured
// cluster API answers a cheap call. One unreachable remote cluster
// shouldn't take the dashboard out of the Service endpoints, so a
// "?cluster=name" override lets the probe target a single cluster
// (typically the local in-cluster one for the platform's own probe).
// Without the override, we probe the default cluster — usually "local"
// for single-cluster deployments. The endpoint is unauthenticated, so
// the body is a bare "not ready" (identical for unknown and failing
// clusters — no cluster-name enumeration); the reason goes to the
// server log instead.
export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('cluster') || defaultCluster();
	if (!listClusters().includes(target)) {
		console.error(`readyz: unknown cluster "${target}"`);
		return notReady();
	}
	try {
		await time(`${target}/readyz/listNamespace`, () =>
			core(target).listNamespace({ limit: 1 })
		);
		return new Response('ready\n', { status: 200, headers: { 'content-type': 'text/plain' } });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`readyz: ${target} not ready: ${msg}`);
		return notReady();
	}
};

function notReady(): Response {
	return new Response('not ready\n', { status: 503, headers: { 'content-type': 'text/plain' } });
}
