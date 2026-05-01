import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRead } from '$lib/authz';
import { getTarget, resolveUri, safeHost } from '$lib/db-targets.server';
import { fetchPgStats, type PgStats } from '$lib/db-pg.server';
import { fetchRedisStats, type RedisStats } from '$lib/db-redis.server';

export type DbDetail =
	| { ok: true; kind: 'postgres'; label: string; cluster?: string; host: string; stats: PgStats }
	| { ok: true; kind: 'redis'; label: string; cluster?: string; host: string; stats: RedisStats }
	| { ok: false; reason: string; label: string; cluster?: string; host: string; kind: 'postgres' | 'redis' };

// Detail: fires the predefined stat queries and returns whatever
// came back. Errors are bubbled up through the union return type so
// the page can render them inline rather than 500.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);

	const t = getTarget(event.params.name);
	if (!t) throw error(404, `Unknown DB target "${event.params.name}"`);

	// Tag a custom invalidation key so the client can poll-refresh
	// just this loader without disturbing the rest of the page tree.
	event.depends(`db:${t.name}`);

	const uri = resolveUri(t);
	const host = safeHost(uri);
	const label = t.label ?? `${t.kind} / ${t.name}`;
	const base = { label, cluster: t.cluster, host, kind: t.kind };

	if (!uri) {
		return {
			detail: {
				ok: false,
				reason: `connection URI env "${t.uriEnv}" is not set`,
				...base
			} satisfies DbDetail,
			target: { name: t.name, kind: t.kind, label, cluster: t.cluster, host }
		};
	}

	if (t.kind === 'postgres') {
		const stats = await fetchPgStats(t.name, uri, session, t.cluster);
		return {
			detail: { ok: true, kind: 'postgres', label, cluster: t.cluster, host, stats } satisfies DbDetail,
			target: { name: t.name, kind: t.kind, label, cluster: t.cluster, host }
		};
	} else {
		const stats = await fetchRedisStats(t.name, uri, session, t.cluster);
		return {
			detail: { ok: true, kind: 'redis', label, cluster: t.cluster, host, stats } satisfies DbDetail,
			target: { name: t.name, kind: t.kind, label, cluster: t.cluster, host }
		};
	}
};
