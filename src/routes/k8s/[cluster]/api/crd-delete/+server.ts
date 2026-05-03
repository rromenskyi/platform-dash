import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiextensions, customObjects } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canWrite } from '$lib/authz';
import { audited } from '$lib/audit.server';

function pickServingVersion(
	versions: Array<{ name: string; storage?: boolean; served?: boolean }> | undefined
): string | null {
	if (!versions || versions.length === 0) return null;
	const stored = versions.find((v) => v.storage && v.served);
	if (stored) return stored.name;
	const served = versions.find((v) => v.served);
	return served ? served.name : versions[0].name;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);

	const reqBody = (await request.json()) as {
		crdName?: string;
		namespace?: string;
		name?: string;
	};
	if (!reqBody.crdName || !reqBody.name) {
		throw error(400, 'crdName and name are required');
	}
	if (!canWrite(session, cluster, reqBody.namespace)) {
		throw error(403, 'platform_admin, cluster_<x>_admin, or namespace_<x>_admin role required');
	}

	let group = '';
	let plural = '';
	let scope = '';
	let servingVersion: string | null = null;
	try {
		const crd = await apiextensions(cluster).readCustomResourceDefinition({ name: reqBody.crdName });
		group = crd.spec.group;
		plural = crd.spec.names.plural;
		scope = crd.spec.scope;
		servingVersion = pickServingVersion(crd.spec.versions);
	} catch {
		throw error(404, `CRD "${reqBody.crdName}" not found`);
	}
	if (!servingVersion) throw error(409, 'CRD has no served version');
	if (scope === 'Namespaced' && !reqBody.namespace) {
		throw error(400, `${reqBody.crdName} is namespaced — namespace is required`);
	}
	if (scope !== 'Namespaced' && reqBody.namespace) {
		throw error(400, `${reqBody.crdName} is cluster-scoped — namespace must not be set`);
	}
	if (scope !== 'Namespaced' && !canWrite(session, cluster)) {
		throw error(403, `cluster-scoped ${reqBody.crdName} requires cluster_<x>_admin or platform_admin`);
	}

	const auditBase = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster,
		action: 'crd-delete',
		target: {
			kind: reqBody.crdName,
			namespace: reqBody.namespace,
			name: reqBody.name
		}
	};

	try {
		await audited(auditBase, () =>
			scope === 'Namespaced'
				? customObjects(cluster).deleteNamespacedCustomObject({
						group,
						version: servingVersion!,
						namespace: reqBody.namespace ?? '',
						plural,
						name: reqBody.name!
					})
				: customObjects(cluster).deleteClusterCustomObject({
						group,
						version: servingVersion!,
						plural,
						name: reqBody.name!
					})
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
