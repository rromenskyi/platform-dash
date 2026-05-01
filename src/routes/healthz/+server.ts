import type { RequestHandler } from './$types';

// Liveness probe — answers "is the SvelteKit Node process up". Does
// not touch the kube API on purpose; that's /readyz. K8s should kill
// the pod only when this fails.
export const GET: RequestHandler = () =>
	new Response('ok\n', { status: 200, headers: { 'content-type': 'text/plain' } });
