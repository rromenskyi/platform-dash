import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRead } from '$lib/authz';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

// Loader returns ONLY metadata + key list + per-key value length.
// Decoded plaintext is never serialised into the page payload — it
// would land in the HTML response for every viewer regardless of
// whether they ever clicked "reveal". The UI fetches per-key
// plaintext on demand via /api/secret-reveal, which gates admin vs
// sre and audits each access individually.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const { cluster, ns, name } = event.params;
	requireRead(session, cluster);

	try {
		const sec = await time(`${cluster}/readNamespacedSecret`, () =>
			core(cluster).readNamespacedSecret({ name, namespace: ns })
		);

		const data = (sec.data ?? {}) as Record<string, string>;
		const keys: Array<{ key: string; len: number }> = [];
		for (const [k, v] of Object.entries(data)) {
			let len = 0;
			try {
				len = Buffer.from(v, 'base64').length;
			} catch {
				len = 0;
			}
			keys.push({ key: k, len });
		}
		keys.sort((a, b) => a.key.localeCompare(b.key));

		return {
			cluster,
			ns,
			name,
			type: sec.type ?? 'Opaque',
			keys,
			creationTimestamp: sec.metadata?.creationTimestamp
				? new Date(sec.metadata.creationTimestamp).toISOString()
				: undefined
		};
	} catch (err) {
		console.error('read secret failed', err);
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `Secret ${ns}/${name} not found`);
	}
};
