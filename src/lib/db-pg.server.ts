import pg from 'pg';
import { record } from './audit.server';
import { withDeadline } from './index';
import type { Session } from '@auth/core/types';

// Postgres stats client. One Pool per target, keyed by target name —
// reuse across requests so we don't pay handshake on every 30s poll.
// Pools are small (max=2) since the dashboard is read-only and
// shouldn't compete with real workloads for connections.
//
// Every query that runs is enumerated below — never accept free-form
// SQL from the client. Each one needs only `pg_monitor` grant.

const QUERIES = {
	dbSizes: `SELECT datname, pg_database_size(datname) AS bytes
		FROM pg_database
		WHERE datistemplate = false
		ORDER BY pg_database_size(datname) DESC`,
	connections: `SELECT state, count(*)::int AS n
		FROM pg_stat_activity
		WHERE pid <> pg_backend_pid()
		GROUP BY state`,
	maxConnections: `SELECT setting::int AS n FROM pg_settings WHERE name = 'max_connections'`,
	replication: `SELECT pg_is_in_recovery() AS in_recovery,
		EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::float AS lag_sec`,
	uptime: `SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::int AS sec`,
	version: `SELECT version() AS v`
} as const;

export type PgStats = {
	ok: boolean;
	error?: string;
	host?: string;
	version?: string;
	uptimeSec?: number;
	dbs: Array<{ name: string; bytes: number }>;
	totalBytes: number;
	connections: { active: number; idle: number; idleInTx: number; other: number; max: number };
	replication?: { inRecovery: boolean; lagSec?: number };
};

type CachedPool = { uri: string; pool: pg.Pool };
const pools = new Map<string, CachedPool>();

function buildPool(label: string, connStr: string): pg.Pool {
	const pool = new pg.Pool({
		connectionString: connStr,
		max: 2,
		idleTimeoutMillis: 60_000,
		connectionTimeoutMillis: 5_000,
		application_name: 'platform-dash'
	});
	// Pool-level error handler — without it, idle client errors crash
	// the process. We just log; the next acquire will rebuild a client.
	pool.on('error', (err) => {
		console.error(`pg pool [${label}] idle error`, err);
	});
	return pool;
}

function getPool(targetName: string, uri: string): pg.Pool {
	const cached = pools.get(targetName);
	// Invalidate on URI drift — same pattern as the Redis / MySQL
	// caches. Applier rotates ACL passwords; stale pools must die
	// or every query fails with auth-failed forever.
	if (cached && cached.uri === uri) return cached.pool;
	if (cached) {
		cached.pool.end().catch(() => {
			/* */
		});
	}
	const pool = buildPool(targetName, uri);
	pools.set(targetName, { uri, pool });
	return pool;
}

// Per-(target,db) pool cache. Drill-in pages connect to a specific
// database to read its tables / indexes. The base URI's db (usually
// `postgres`) only sees server-wide stats; per-relation reads need
// the actual db connection.
function getPoolForDb(targetName: string, uri: string, dbName: string): pg.Pool {
	const key = `${targetName}::${dbName}`;
	let connStr = uri;
	try {
		const u = new URL(uri);
		u.pathname = `/${dbName}`;
		connStr = u.toString();
	} catch {
		/* malformed URI — let pg.Pool fail loudly on first acquire */
	}
	const cached = pools.get(key);
	if (cached && cached.uri === connStr) return cached.pool;
	if (cached) {
		cached.pool.end().catch(() => {
			/* */
		});
	}
	const pool = buildPool(key, connStr);
	pools.set(key, { uri: connStr, pool });
	return pool;
}

export async function fetchPgStats(
	targetName: string,
	uri: string,
	session: Session | null,
	cluster?: string
): Promise<PgStats> {
	const pool = getPool(targetName, uri);
	const baseAudit = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster: cluster ?? 'external',
		action: 'db-stats-pg',
		target: { kind: 'Database', name: targetName }
	};

	let host = '';
	try {
		host = new URL(uri).host;
	} catch {
		/* */
	}

	const start = performance.now();
	try {
		// Bound the whole connect+query block to 8s — see db-redis.server.ts
		// for the underlying reasoning. node-postgres pool.connect() can
		// stall when all clients are checked out and no connection is
		// idle, and individual queries have no built-in statement timeout.
		const client = await withDeadline(
			pool.connect(),
			8_000,
			`pg [${targetName}] connect`,
			(c) => c.release()
		);
		// A timed-out query keeps running on this client — destroy it
		// rather than hand a busy connection back to the pool.
		let broken = false;
		try {
			const [sizes, conns, maxConns, repl, uptime, ver] = await withDeadline(
				Promise.all([
					client.query<{ datname: string; bytes: string }>(QUERIES.dbSizes),
					client.query<{ state: string | null; n: number }>(QUERIES.connections),
					client.query<{ n: number }>(QUERIES.maxConnections),
					client.query<{ in_recovery: boolean; lag_sec: number | null }>(QUERIES.replication),
					client.query<{ sec: number }>(QUERIES.uptime),
					client.query<{ v: string }>(QUERIES.version)
				]),
				8_000,
				`pg [${targetName}] stats query`
			);
			let active = 0,
				idle = 0,
				idleInTx = 0,
				other = 0;
			for (const r of conns.rows) {
				if (r.state === 'active') active = r.n;
				else if (r.state === 'idle') idle = r.n;
				else if (r.state === 'idle in transaction') idleInTx = r.n;
				else other += r.n;
			}
			const dbs = sizes.rows.map((r) => ({ name: r.datname, bytes: Number(r.bytes) }));
			const totalBytes = dbs.reduce((a, b) => a + b.bytes, 0);
			const replication = repl.rows[0]
				? {
						inRecovery: !!repl.rows[0].in_recovery,
						lagSec: repl.rows[0].lag_sec == null ? undefined : Number(repl.rows[0].lag_sec)
					}
				: undefined;
			record({
				...baseAudit,
				outcome: 'ok',
				durationMs: Math.round(performance.now() - start)
			});
			return {
				ok: true,
				host,
				version: ver.rows[0]?.v?.split(' on ')[0],
				uptimeSec: uptime.rows[0]?.sec,
				dbs,
				totalBytes,
				connections: {
					active,
					idle,
					idleInTx,
					other,
					max: maxConns.rows[0]?.n ?? 0
				},
				replication
			};
		} catch (err) {
			broken = true;
			throw err;
		} finally {
			client.release(broken);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		record({
			...baseAudit,
			outcome: 'error',
			message: msg,
			durationMs: Math.round(performance.now() - start)
		});
		return {
			ok: false,
			error: msg,
			host,
			dbs: [],
			totalBytes: 0,
			connections: { active: 0, idle: 0, idleInTx: 0, other: 0, max: 0 }
		};
	}
}

// ── Per-db drill-in ──────────────────────────────────────────────────────────

export type PgRelation = {
	schema: string;
	name: string;
	kind: string; // 'table' | 'index' | 'view' | 'matview' | ...
	bytes: number;
	rows: number;
};

export type PgDbDetail = {
	ok: boolean;
	error?: string;
	dbName: string;
	totalBytes: number;
	relations: PgRelation[];
	connectError?: string;
};

const KIND_LABEL: Record<string, string> = {
	r: 'table',
	i: 'index',
	v: 'view',
	m: 'matview',
	p: 'partitioned',
	S: 'sequence',
	t: 'toast'
};

export async function fetchPgDbDetail(
	targetName: string,
	uri: string,
	dbName: string,
	session: Session | null,
	cluster?: string
): Promise<PgDbDetail> {
	const baseAudit = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster: cluster ?? 'external',
		action: 'db-stats-pg-drill',
		target: { kind: 'Database', name: targetName, db: dbName }
	};
	const start = performance.now();
	try {
		const pool = getPoolForDb(targetName, uri, dbName);
		const client = await withDeadline(
			pool.connect(),
			8_000,
			`pg [${targetName}/${dbName}] connect`,
			(c) => c.release()
		);
		// A timed-out query keeps running on this client — destroy it
		// rather than hand a busy connection back to the pool.
		let broken = false;
		try {
			const res = await withDeadline(
				client.query<{
					nspname: string;
					relname: string;
					relkind: string;
					bytes: string;
					rows: string;
				}>(
					`SELECT n.nspname, c.relname, c.relkind,
						pg_total_relation_size(c.oid) AS bytes,
						COALESCE(c.reltuples, 0)::bigint AS rows
					FROM pg_class c
					JOIN pg_namespace n ON n.oid = c.relnamespace
					WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
					  AND c.relkind IN ('r', 'p', 'm', 'v', 'i')
					ORDER BY pg_total_relation_size(c.oid) DESC
					LIMIT 100`
				),
				8_000,
				`pg [${targetName}/${dbName}] relations`
			);
			const relations = res.rows.map((r) => ({
				schema: r.nspname,
				name: r.relname,
				kind: KIND_LABEL[r.relkind] ?? r.relkind,
				bytes: Number(r.bytes),
				rows: Number(r.rows)
			}));
			const totalBytes = relations
				.filter((r) => r.kind !== 'index')
				.reduce((a, b) => a + b.bytes, 0);
			record({
				...baseAudit,
				outcome: 'ok',
				durationMs: Math.round(performance.now() - start)
			});
			return { ok: true, dbName, totalBytes, relations };
		} catch (err) {
			broken = true;
			throw err;
		} finally {
			client.release(broken);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		record({
			...baseAudit,
			outcome: 'error',
			message: msg,
			durationMs: Math.round(performance.now() - start)
		});
		return {
			ok: false,
			error: msg,
			dbName,
			totalBytes: 0,
			relations: []
		};
	}
}

// ── Slow queries (pg_stat_statements, optional extension) ────────────────────

export type PgSlowQuery = {
	query: string;
	calls: number;
	totalMs: number;
	meanMs: number;
	rows: number;
};

export type PgSlowQueriesResult =
	| { ok: true; rows: PgSlowQuery[] }
	| { ok: false; reason: string };

export async function fetchPgSlowQueries(
	targetName: string,
	uri: string,
	session: Session | null,
	cluster?: string
): Promise<PgSlowQueriesResult> {
	const pool = getPool(targetName, uri);
	const baseAudit = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster: cluster ?? 'external',
		action: 'db-stats-pg-slow',
		target: { kind: 'Database', name: targetName }
	};
	const start = performance.now();
	try {
		const client = await withDeadline(
			pool.connect(),
			8_000,
			`pg [${targetName}] connect (slow)`,
			(c) => c.release()
		);
		// A timed-out query keeps running on this client — destroy it
		// rather than hand a busy connection back to the pool.
		let broken = false;
		try {
			// pg_stat_statements ships as an extension (default OFF on
			// most installs). Surface the missing-extension case as a
			// soft error rather than a 500 — operator can install via
			// CREATE EXTENSION pg_stat_statements; once they're ready.
			const res = await withDeadline(
				client.query<{
					query: string;
					calls: string;
					total_exec_time: string;
					mean_exec_time: string;
					rows: string;
				}>(
					`SELECT query, calls, total_exec_time, mean_exec_time, rows
					FROM pg_stat_statements
					ORDER BY total_exec_time DESC
					LIMIT 20`
				),
				8_000,
				`pg [${targetName}] slow-query scan`
			);
			record({
				...baseAudit,
				outcome: 'ok',
				durationMs: Math.round(performance.now() - start)
			});
			return {
				ok: true,
				rows: res.rows.map((r) => ({
					query: r.query,
					calls: Number(r.calls),
					totalMs: Number(r.total_exec_time),
					meanMs: Number(r.mean_exec_time),
					rows: Number(r.rows)
				}))
			};
		} catch (err) {
			broken = true;
			throw err;
		} finally {
			client.release(broken);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// Distinguish "extension not installed" from real errors. The
		// extension being absent is the default state on fresh
		// Postgres clusters and isn't an error worth alerting on —
		// audit it as `ok` with a hint message and surface the soft
		// reason to the UI so the operator sees "install pg_stat_statements"
		// instead of a red error toast.
		const missing =
			/relation "?pg_stat_statements"? does not exist/i.test(msg) ||
			(typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '42P01');
		record({
			...baseAudit,
			outcome: missing ? 'ok' : 'error',
			message: missing ? 'pg_stat_statements not installed' : msg,
			durationMs: Math.round(performance.now() - start)
		});
		return {
			ok: false,
			reason: missing
				? 'pg_stat_statements extension not installed — run `CREATE EXTENSION pg_stat_statements;` as superuser to enable slow-query tracking'
				: msg
		};
	}
}
