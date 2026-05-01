import type { RequestHandler } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

// Readiness probe — pod is "ready" only if the cluster API responds
// to a cheap call. Failure removes us from the Service endpoints
// without killing the process (liveness will if it stays broken).
export const GET: RequestHandler = async () => {
	try {
		await time('readyz/listNamespace', () => core().listNamespace({ limit: 1 }));
		return new Response('ready\n', { status: 200, headers: { 'content-type': 'text/plain' } });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return new Response(`not ready: ${msg}\n`, {
			status: 503,
			headers: { 'content-type': 'text/plain' }
		});
	}
};
