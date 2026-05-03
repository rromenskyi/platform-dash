import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parse as parseYaml } from 'yaml';
import { apiextensions, customObjects } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canWrite } from '$lib/authz';
import { audited } from '$lib/audit.server';

// Replace a custom object. Body shape:
//   { crdName, namespace?, name, body: <YAML or JSON string> }
// We parse YAML first, fall back to JSON. The replace API needs the
// resourceVersion the client read before edit so concurrent writers
// get a 409 instead of trampling each other — pass it through verbatim.
function pickServingVersion(
	versions: Array<{ name: string; storage?: boolean; served?: boolean }> | undefined
): string | null {
	if (!versions || versions.length === 0) return null;
	const stored = versions.find((v) => v.storage && v.served);
	if (stored) return stored.name;
	const served = versions.find((v) => v.served);
	return served ? served.name : versions[0].name;
}

function parseBody(raw: string): Record<string, unknown> {
	const trimmed = raw.trim();
	if (!trimmed) throw new Error('empty body');
	try {
		return parseYaml(trimmed) as Record<string, unknown>;
	} catch {
		return JSON.parse(trimmed) as Record<string, unknown>;
	}
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);

	const reqBody = (await request.json()) as {
		crdName?: string;
		namespace?: string;
		name?: string;
		body?: string;
	};
	if (!reqBody.crdName || !reqBody.name || !reqBody.body) {
		throw error(400, 'crdName, name and body are required');
	}
	// CRD scope hasn't been resolved yet — we re-check below once we
	// know whether the target is namespaced. Cluster-scoped writes
	// require cluster_admin or platform_admin (no ns can grant it).
	if (!canWrite(session, cluster, reqBody.namespace)) {
		throw error(403, 'platform_admin, cluster_<x>_admin, or namespace_<x>_admin role required');
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = parseBody(reqBody.body);
	} catch (err) {
		throw error(400, `invalid YAML/JSON: ${err instanceof Error ? err.message : String(err)}`);
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
	} catch (err) {
		throw error(404, `CRD "${reqBody.crdName}" not found`);
	}
	if (!servingVersion) throw error(409, 'CRD has no served version');
	// Reject upfront when a namespaced CRD is being replaced without
	// a namespace; otherwise the apiserver returns a cryptic
	// "namespace required" message and the operator has to read the
	// audit row to figure out what's wrong.
	if (scope === 'Namespaced' && !reqBody.namespace) {
		throw error(400, `${reqBody.crdName} is namespaced — namespace is required`);
	}
	if (scope !== 'Namespaced' && reqBody.namespace) {
		throw error(400, `${reqBody.crdName} is cluster-scoped — namespace must not be set`);
	}
	// Defensive re-check now that scope is known. For a cluster-scoped
	// CRD a namespace-only role must NOT be sufficient — re-call
	// canWrite without the namespace arg so only cluster/global
	// admins pass.
	if (scope !== 'Namespaced' && !canWrite(session, cluster)) {
		throw error(403, `cluster-scoped ${reqBody.crdName} requires cluster_<x>_admin or platform_admin`);
	}

	const auditBase = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster,
		action: 'crd-replace',
		target: {
			kind: reqBody.crdName,
			namespace: reqBody.namespace,
			name: reqBody.name
		}
	};

	try {
		const result = await audited(auditBase, () =>
			scope === 'Namespaced'
				? customObjects(cluster).replaceNamespacedCustomObject({
						group,
						version: servingVersion!,
						namespace: reqBody.namespace ?? '',
						plural,
						name: reqBody.name!,
						body: parsed
					})
				: customObjects(cluster).replaceClusterCustomObject({
						group,
						version: servingVersion!,
						plural,
						name: reqBody.name!,
						body: parsed
					})
		);
		return json({ ok: true, object: result });
	} catch (err) {
		const code =
			typeof err === 'object' && err !== null && 'code' in err
				? (err as { code: number }).code
				: 500;
		const msg = err instanceof Error ? err.message : String(err);
		throw error(code === 401 || code === 403 ? 403 : code === 409 ? 409 : 500, msg);
	}
};
