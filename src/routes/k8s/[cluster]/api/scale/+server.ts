import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apps, kubeError } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canWrite } from '$lib/authz';
import { audited } from '$lib/audit.server';
import { readJson } from '$lib/csrf.server';

// Scale via the /scale subresource so we don't accidentally mutate
// anything else on the spec. Replicas are clamped server-side: 0..50
// is plenty for the platform's single-operator workloads, and a
// fat-fingered "300" doesn't drain the cluster.
const MAX_REPLICAS = 50;

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);

	const body = await readJson<{
		kind?: 'Deployment' | 'StatefulSet';
		namespace?: string;
		name?: string;
		replicas?: number;
	}>(request);
	if (!body.namespace || !body.name) throw error(400, 'namespace + name required');
	if (body.kind !== 'Deployment' && body.kind !== 'StatefulSet') {
		throw error(400, 'kind must be Deployment or StatefulSet');
	}
	const r = Number(body.replicas);
	if (!Number.isInteger(r) || r < 0 || r > MAX_REPLICAS) {
		throw error(400, `replicas must be an integer in 0..${MAX_REPLICAS}`);
	}
	if (!canWrite(session, cluster, body.namespace)) {
		throw error(403, 'platform_admin, cluster_<x>_admin, or namespace_<x>_admin role required');
	}

	// RFC 6902 JSON Patch — the SDK's default Content-Type for
	// patchNamespacedDeploymentScale / patchNamespacedStatefulSetScale
	// is application/json-patch+json (first in its accepted list), so
	// the body must be an array of ops, not a merge-patch object.
	// The /scale subresource always exposes spec.replicas (default 1),
	// so "replace" is safe without needing "add".
	const patch = [{ op: 'replace', path: '/spec/replicas', value: r }];
	const target = {
		kind: body.kind,
		namespace: body.namespace,
		name: body.name,
		replicas: r
	};
	const baseEvent = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster,
		action: 'scale',
		target
	};

	try {
		await audited(baseEvent, () =>
			body.kind === 'Deployment'
				? apps(cluster).patchNamespacedDeploymentScale({
						name: body.name!,
						namespace: body.namespace!,
						body: patch
					})
				: apps(cluster).patchNamespacedStatefulSetScale({
						name: body.name!,
						namespace: body.namespace!,
						body: patch
					})
		);
		return json({ ok: true, replicas: r });
	} catch (err) {
		const { code, message } = kubeError(err);
		throw error(code === 401 || code === 403 ? 403 : 500, message);
	}
};
