import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parse as parseYaml } from 'yaml';
import { core, kubeError } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canWrite } from '$lib/authz';
import { audited } from '$lib/audit.server';

// Replace a ConfigMap. Body shape:
//   { namespace, name, body: <YAML or JSON of full ConfigMap object> }
// resourceVersion in the body is preserved verbatim — concurrent edits
// land a 409 from the apiserver instead of last-write-wins. binaryData
// passes through if present in the body.

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
		namespace?: string;
		name?: string;
		body?: string;
	};
	if (!reqBody.namespace || !reqBody.name || !reqBody.body) {
		throw error(400, 'namespace, name and body are required');
	}
	if (!canWrite(session, cluster, reqBody.namespace)) {
		throw error(403, 'platform_admin, cluster_<x>_admin, or namespace_<x>_admin role required');
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = parseBody(reqBody.body);
	} catch (err) {
		throw error(400, `invalid YAML/JSON: ${err instanceof Error ? err.message : String(err)}`);
	}

	const auditBase = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster,
		action: 'cm-replace',
		target: { kind: 'ConfigMap', namespace: reqBody.namespace, name: reqBody.name }
	};

	try {
		const result = await audited(auditBase, () =>
			core(cluster).replaceNamespacedConfigMap({
				name: reqBody.name!,
				namespace: reqBody.namespace!,
				// SDK is strict on typing; the parsed object satisfies the
				// shape — `apiVersion`, `kind`, `metadata` and either
				// `data` or `binaryData` come straight from the editor.
				body: parsed as never
			})
		);
		return json({ ok: true, object: result });
	} catch (err) {
		const { code, message } = kubeError(err);
		const status =
			code === 401 || code === 403
				? 403
				: code === 409
					? 409
					: code === 422
						? 422
						: 500;
		throw error(status, message);
	}
};
