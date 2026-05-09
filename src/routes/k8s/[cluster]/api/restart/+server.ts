import { error, json } from '@sveltejs/kit';
import { setHeaderOptions } from '@kubernetes/client-node';
import type { RequestHandler } from './$types';
import { apps } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canWrite } from '$lib/authz';
import { audited } from '$lib/audit.server';

// PATCH on AppsV1Api defaults to `application/json-patch+json`
// (RFC 6902, array of {op,path,value}). Our patch body is a deeply
// nested object — the strategic-merge-patch shape — which the API
// server can't decode against the json-patch schema and rejects
// with HTTP 400. Override the header per call to match the body.
//
// Strategic Merge Patch (vs JSON Merge Patch): handles "merge per
// key", "create parent path if missing", and the AppsV1 schema's
// special $patch directives. The annotation map under
// spec.template.metadata.annotations is the merge target — without
// strategic semantics a plain merge would replace the whole map and
// wipe sibling annotations like deployment.kubernetes.io/revision.
const STRATEGIC_MERGE_PATCH = setHeaderOptions(
	'Content-Type',
	'application/strategic-merge-patch+json'
);

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

	const body = (await request.json()) as {
		kind?: 'Deployment' | 'StatefulSet';
		namespace?: string;
		name?: string;
	};
	if (!body.namespace || !body.name) throw error(400, 'namespace + name required');
	if (body.kind !== 'Deployment' && body.kind !== 'StatefulSet') {
		throw error(400, 'kind must be Deployment or StatefulSet');
	}
	if (!canWrite(session, cluster, body.namespace)) {
		throw error(403, 'platform_admin, cluster_<x>_admin, or namespace_<x>_admin role required');
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
				? apps(cluster).patchNamespacedDeployment(
						{
							name: body.name!,
							namespace: body.namespace!,
							body: patch
						},
						STRATEGIC_MERGE_PATCH
					)
				: apps(cluster).patchNamespacedStatefulSet(
						{
							name: body.name!,
							namespace: body.namespace!,
							body: patch
						},
						STRATEGIC_MERGE_PATCH
					)
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
