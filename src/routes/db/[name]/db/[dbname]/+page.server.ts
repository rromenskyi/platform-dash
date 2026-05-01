import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRead } from '$lib/authz';
import { ensureFresh, getTarget, safeHost } from '$lib/db-targets.server';
import { fetchPgDbDetail, type PgDbDetail } from '$lib/db-pg.server';
import { fetchMysqlDbDetail, type MysqlDbDetail } from '$lib/db-mysql.server';

export type DbDrillDetail =
	| { ok: true; kind: 'postgres'; detail: PgDbDetail }
	| { ok: true; kind: 'mysql'; detail: MysqlDbDetail }
	| { ok: false; reason: string; kind: 'postgres' | 'mysql' };

// Drill-in: per-database table/index sizes. Only postgres + mysql
// support per-db browsing; redis has no db-as-namespace concept of
// the same kind (its keyspace is flat).
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);

	await ensureFresh();

	const t = getTarget(event.params.name);
	if (!t) throw error(404, `Unknown DB target "${event.params.name}"`);
	if (t.kind === 'redis') throw error(400, 'Redis has no per-db drill-in');

	event.depends(`db:${t.name}:${event.params.dbname}`);

	const host = safeHost(t.uri);
	const label = t.label ?? `${t.kind} / ${t.name}`;
	const target = { name: t.name, kind: t.kind, label, cluster: t.cluster, host };
	const dbName = event.params.dbname;

	if (!t.uri) {
		return {
			target,
			dbName,
			drill: {
				ok: false,
				reason: t.uriHint ?? 'connection URI not resolved',
				kind: t.kind as 'postgres' | 'mysql'
			} satisfies DbDrillDetail
		};
	}

	if (t.kind === 'postgres') {
		const detail = await fetchPgDbDetail(t.name, t.uri, dbName, session, t.cluster);
		return {
			target,
			dbName,
			drill: { ok: true, kind: 'postgres', detail } satisfies DbDrillDetail
		};
	}
	const detail = await fetchMysqlDbDetail(t.name, t.uri, dbName, session, t.cluster);
	return {
		target,
		dbName,
		drill: { ok: true, kind: 'mysql', detail } satisfies DbDrillDetail
	};
};
