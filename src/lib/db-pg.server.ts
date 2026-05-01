import pg from 'pg';
import { record } from './audit.server';
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

const pools = new Map<string, pg.Pool>();

function getPool(targetName: string, uri: string): pg.Pool {
	const cached = pools.get(targetName);
	if (cached) return cached;
	const pool = new pg.Pool({
		connectionString: uri,
		max: 2,
		idleTimeoutMillis: 60_000,
		connectionTimeoutMillis: 5_000,
		application_name: 'platform-dash'
	});
	// Pool-level error handler — without it, idle client errors crash
	// the process. We just log; the next acquire will rebuild a client.
	pool.on('error', (err) => {
		console.error(`pg pool [${targetName}] idle error`, err);
	});
	pools.set(targetName, pool);
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
		const client = await pool.connect();
		try {
			const [sizes, conns, maxConns, repl, uptime, ver] = await Promise.all([
				client.query<{ datname: string; bytes: string }>(QUERIES.dbSizes),
				client.query<{ state: string | null; n: number }>(QUERIES.connections),
				client.query<{ n: number }>(QUERIES.maxConnections),
				client.query<{ in_recovery: boolean; lag_sec: number | null }>(QUERIES.replication),
				client.query<{ sec: number }>(QUERIES.uptime),
				client.query<{ v: string }>(QUERIES.version)
			]);
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
		} finally {
			client.release();
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
