import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apps } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canWrite } from '$lib/authz';
import { audited } from '$lib/audit.server';

// kubectl rollout restart equivalent — patch the pod template
// metadata with a fresh annotation. K8s notices the template hash
// changed and rolls a new ReplicaSet / StatefulSet revision. The
// annotation key is the one kubectl itself uses, so two operators
// using both tools see consistent behaviour.
const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);
	if (!canWrite(session, cluster)) {
		throw error(403, 'platform_admin or cluster_<name>_admin role required');
	}

	const body = (await request.json()) as {
		kind?: 'Deployment' | 'StatefulSet';
		namespace?: string;
		name?: string;
	};
	if (!body.namespace || !body.name) throw error(400, 'namespace + name required');
	if (body.kind !== 'Deployment' && body.kind !== 'StatefulSet') {
		throw error(400, 'kind must be Deployment or StatefulSet');
	}

	const patch = {
		spec: {
			template: {
				metadata: {
					annotations: { [RESTART_ANNOTATION]: new Date().toISOString() }
				}
			}
		}
	};

	const target = { kind: body.kind, namespace: body.namespace, name: body.name };
	const baseEvent = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster,
		action: 'restart',
		target
	};

	try {
		await audited(baseEvent, () =>
			body.kind === 'Deployment'
				? apps(cluster).patchNamespacedDeployment({
						name: body.name!,
						namespace: body.namespace!,
						body: patch
					})
				: apps(cluster).patchNamespacedStatefulSet({
						name: body.name!,
						namespace: body.namespace!,
						body: patch
					})
		);
		return json({ ok: true, restartedAt: patch.spec.template.metadata.annotations[RESTART_ANNOTATION] });
	} catch (err) {
		const code =
			typeof err === 'object' && err !== null && 'code' in err
				? (err as { code: number }).code
				: 500;
		const msg = err instanceof Error ? err.message : String(err);
		throw error(code === 401 || code === 403 ? 403 : 500, msg);
	}
};
