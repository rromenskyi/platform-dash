import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { core } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canWrite } from '$lib/authz';
import { audited } from '$lib/audit.server';

// "Kick the pod" — controller will respawn if it has one. Default
// gracePeriod respects the pod's own terminationGracePeriodSeconds;
// callers can pass a low value for a hard kill but we don't expose
// that in the UI yet (would be a footgun for stateful pods).
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);

	const body = (await request.json()) as { namespace?: string; name?: string };
	if (!body.namespace || !body.name) throw error(400, 'namespace + name required');
	if (!canWrite(session, cluster, body.namespace)) {
		throw error(403, 'platform_admin, cluster_<x>_admin, or namespace_<x>_admin role required');
	}

	const target = { kind: 'Pod', namespace: body.namespace, name: body.name };
	const baseEvent = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster,
		action: 'pod-delete',
		target
	};

	try {
		await audited(baseEvent, () =>
			core(cluster).deleteNamespacedPod({ name: body.name!, namespace: body.namespace! })
		);
		return json({ ok: true });
	} catch (err) {
		const code =
			typeof err === 'object' && err !== null && 'code' in err
				? (err as { code: number }).code
				: 500;
		const msg = err instanceof Error ? err.message : String(err);
		throw error(code === 401 || code === 403 ? 403 : 500, msg);
	}
};
