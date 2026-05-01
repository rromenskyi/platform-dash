import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRead } from '$lib/authz';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { record } from '$lib/audit.server';

// Secret values are returned base64-encoded by the API. We decode
// server-side so the UI doesn't have to ship a decoder, but log a
// view event in the audit stream — even sre-level reads of secret
// data are worth a record.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const { cluster, ns, name } = event.params;
	requireRead(session, cluster);

	try {
		const sec = await time(`${cluster}/readNamespacedSecret`, () =>
			core(cluster).readNamespacedSecret({ name, namespace: ns })
		);

		const decoded: Record<string, string> = {};
		for (const [k, v] of Object.entries((sec.data ?? {}) as Record<string, string>)) {
			try {
				decoded[k] = Buffer.from(v, 'base64').toString('utf8');
			} catch {
				decoded[k] = '[unreadable]';
			}
		}

		record({
			user: session?.user?.email ?? session?.user?.name ?? 'unknown',
			roles: session?.roles ?? [],
			cluster,
			action: 'secret-view',
			target: { kind: 'Secret', namespace: ns, name },
			outcome: 'ok'
		});

		return {
			cluster,
			ns,
			name,
			type: sec.type ?? 'Opaque',
			data: decoded,
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
