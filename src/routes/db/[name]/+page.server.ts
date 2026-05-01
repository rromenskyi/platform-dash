import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRead } from '$lib/authz';
import { ensureFresh, getTarget, safeHost } from '$lib/db-targets.server';
import { fetchPgStats, type PgStats } from '$lib/db-pg.server';
import { fetchRedisStats, type RedisStats } from '$lib/db-redis.server';
import { fetchMysqlStats, type MysqlStats } from '$lib/db-mysql.server';

export type DbKindUI = 'postgres' | 'redis' | 'mysql';

export type DbDetail =
	| { ok: true; kind: 'postgres'; label: string; cluster?: string; host: string; stats: PgStats }
	| { ok: true; kind: 'redis'; label: string; cluster?: string; host: string; stats: RedisStats }
	| { ok: true; kind: 'mysql'; label: string; cluster?: string; host: string; stats: MysqlStats }
	| { ok: false; reason: string; label: string; cluster?: string; host: string; kind: DbKindUI };

// Detail: fires the predefined stat queries and returns whatever
// came back. Errors are bubbled up through the union return type so
// the page can render them inline rather than 500.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);

	await ensureFresh();

	const t = getTarget(event.params.name);
	if (!t) throw error(404, `Unknown DB target "${event.params.name}"`);

	// Tag a custom invalidation key so the client can poll-refresh
	// just this loader without disturbing the rest of the page tree.
	event.depends(`db:${t.name}`);

	const host = safeHost(t.uri);
	const label = t.label ?? `${t.kind} / ${t.name}`;
	const base = { label, cluster: t.cluster, host, kind: t.kind };

	if (!t.uri) {
		return {
			detail: {
				ok: false,
				reason: t.uriHint ?? 'connection URI not resolved',
				...base
			} satisfies DbDetail,
			target: { name: t.name, kind: t.kind, label, cluster: t.cluster, host }
		};
	}

	if (t.kind === 'postgres') {
		const stats = await fetchPgStats(t.name, t.uri, session, t.cluster);
		return {
			detail: { ok: true, kind: 'postgres', label, cluster: t.cluster, host, stats } satisfies DbDetail,
			target: { name: t.name, kind: t.kind, label, cluster: t.cluster, host }
		};
	}
	if (t.kind === 'mysql') {
		const stats = await fetchMysqlStats(t.name, t.uri, session, t.cluster);
		return {
			detail: { ok: true, kind: 'mysql', label, cluster: t.cluster, host, stats } satisfies DbDetail,
			target: { name: t.name, kind: t.kind, label, cluster: t.cluster, host }
		};
	}
	const stats = await fetchRedisStats(t.name, t.uri, session, t.cluster);
	return {
		detail: { ok: true, kind: 'redis', label, cluster: t.cluster, host, stats } satisfies DbDetail,
		target: { name: t.name, kind: t.kind, label, cluster: t.cluster, host }
	};
};
