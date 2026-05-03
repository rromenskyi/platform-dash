import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { core } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canRead, canWrite } from '$lib/authz';
import { record } from '$lib/audit.server';

// Per-key secret reveal. Decoded values never ride along in the
// /secrets/<ns>/<name> page payload (would put plaintext in the
// HTML for every viewer regardless of whether they clicked reveal).
// Instead the page fetches each key on demand here.
//
// Authorisation:
//   - canWrite (admin)            → real decoded value
//   - canRead but not canWrite    → returned value is masked with
//     `*` of the same length, audited as 'denied'. UI can't
//     distinguish at first paint, so SREs are not tipped off about
//     real lengths beyond what the masked length already reveals;
//     same length is intentional so the operator can sanity-check
//     "was it set?" without seeing the secret.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);

	const body = (await request.json()) as { namespace?: string; name?: string; key?: string };
	if (!body.namespace || !body.name || !body.key) {
		throw error(400, 'namespace + name + key required');
	}
	if (!canRead(session, cluster, body.namespace)) {
		throw error(
			403,
			'platform_admin/sre, cluster_<x>_admin/sre, or namespace_<x>_admin/sre role required'
		);
	}

	const target = { kind: 'Secret', namespace: body.namespace, name: body.name, key: body.key };
	const baseEvent = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster,
		action: 'secret-reveal',
		target
	};
	const start = performance.now();

	try {
		const sec = await core(cluster).readNamespacedSecret({
			name: body.name,
			namespace: body.namespace
		});
		const b64 = (sec.data ?? {})[body.key] as string | undefined;
		if (b64 === undefined) {
			record({
				...baseEvent,
				outcome: 'error',
				message: `key "${body.key}" missing`,
				durationMs: Math.round(performance.now() - start)
			});
			throw error(404, `Secret ${body.namespace}/${body.name} has no key "${body.key}"`);
		}
		const real = Buffer.from(b64, 'base64').toString('utf8');
		if (!canWrite(session, cluster, body.namespace)) {
			// Caller has read but not write — return same-length mask.
			record({
				...baseEvent,
				outcome: 'denied',
				message: 'sre cannot reveal plaintext',
				durationMs: Math.round(performance.now() - start)
			});
			return json({ value: '*'.repeat(real.length), masked: true });
		}
		record({
			...baseEvent,
			outcome: 'ok',
			durationMs: Math.round(performance.now() - start)
		});
		return json({ value: real, masked: false });
	} catch (err) {
		// `error()` from @sveltejs/kit throws an object with `status`;
		// re-throw those untouched so SvelteKit handles them.
		if (typeof err === 'object' && err !== null && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		record({
			...baseEvent,
			outcome: 'error',
			message: msg,
			durationMs: Math.round(performance.now() - start)
		});
		const code =
			typeof err === 'object' && err !== null && 'code' in err
				? (err as { code: number }).code
				: 500;
		throw error(code === 401 || code === 403 ? 403 : 500, msg);
	}
};
