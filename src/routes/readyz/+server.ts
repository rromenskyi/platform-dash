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
// for single-cluster deployments. Failures surface in the response
// body so an operator running curl gets the underlying reason.
export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('cluster') || defaultCluster();
	if (!listClusters().includes(target)) {
		return new Response(`not ready: unknown cluster "${target}"\n`, {
			status: 503,
			headers: { 'content-type': 'text/plain' }
		});
	}
	try {
		await time(`${target}/readyz/listNamespace`, () =>
			core(target).listNamespace({ limit: 1 })
		);
		return new Response('ready\n', { status: 200, headers: { 'content-type': 'text/plain' } });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return new Response(`not ready (${target}): ${msg}\n`, {
			status: 503,
			headers: { 'content-type': 'text/plain' }
		});
	}
};
