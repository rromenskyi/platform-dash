import mysql from 'mysql2/promise';
import { record } from './audit.server';
import { withDeadline } from './index';
import type { Session } from '@auth/core/types';

// MySQL stats client. One pool per target, kept open across requests.
// dashboard_ro needs:
//   GRANT PROCESS, REPLICATION CLIENT ON *.*
//   GRANT SELECT ON performance_schema.*
//   GRANT SELECT ON information_schema.*
//
// All queries hit metadata only — no tenant data is read.

export type MysqlStats = {
	ok: boolean;
	error?: string;
	host?: string;
	version?: string;
	uptimeSec?: number;
	dbs: Array<{ name: string; bytes: number }>;
	totalBytes: number;
	connections: {
		current: number;
		max: number;
	};
	slowQueries: number;
	bufferPoolHitRate?: number;
};

type CachedPool = { uri: string; pool: mysql.Pool };
const pools = new Map<string, CachedPool>();

function getPool(targetName: string, uri: string): mysql.Pool {
	const cached = pools.get(targetName);
	// Invalidate when the URI changes — same pattern as the Redis
	// client cache. The platform's applier rotates DB ACL passwords
	// on apply; without this guard the cached pool keeps using the
	// stale URI and every query fails with auth-failed forever.
	if (cached && cached.uri === uri) return cached.pool;
	if (cached) {
		cached.pool.end().catch(() => {
			/* draining best-effort */
		});
	}
	const pool = mysql.createPool({
		uri,
		connectionLimit: 2,
		connectTimeout: 5_000
	});
	pools.set(targetName, { uri, pool });
	return pool;
}

export async function fetchMysqlStats(
	targetName: string,
	uri: string,
	session: Session | null,
	cluster?: string
): Promise<MysqlStats> {
	const pool = getPool(targetName, uri);
	const baseAudit = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster: cluster ?? 'external',
		action: 'db-stats-mysql',
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
		// Bound connect+query to 8s — see db-redis.server.ts for the
		// underlying reasoning. mysql2 pool.getConnection() blocks until
		// a slot is free, and individual queries inherit the connection's
		// timeout (default: none) so a wedged server hangs the loader
		// until Cloudflare returns 524.
		const conn = await withDeadline(
			pool.getConnection(),
			8_000,
			`mysql [${targetName}] connect`,
			(c) => c.release()
		);
		// A timed-out query keeps running on this connection — destroy it
		// rather than hand a busy connection back to the pool.
		let broken = false;
		try {
			// mysql2's single connection is strictly sequential — running
			// queries through Promise.all() on the same conn throws
			// "Can't execute commands". Wrap the whole sequence in one
			// deadline so the loader still returns inside 8s if the
			// server stops responding mid-batch.
			const queries = (async () => {
				const [s] = await conn.query<mysql.RowDataPacket[]>(
					`SELECT table_schema AS db, COALESCE(SUM(data_length + index_length), 0) AS bytes
					FROM information_schema.tables
					GROUP BY table_schema
					ORDER BY bytes DESC`
				);
				const [st] = await conn.query<mysql.RowDataPacket[]>(
					`SHOW GLOBAL STATUS WHERE Variable_name IN
					('Uptime','Threads_connected','Slow_queries',
					 'Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads')`
				);
				const [mc] = await conn.query<mysql.RowDataPacket[]>(
					`SHOW VARIABLES LIKE 'max_connections'`
				);
				const [v] = await conn.query<mysql.RowDataPacket[]>(`SELECT VERSION() AS v`);
				return [s, st, mc, v] as const;
			})();
			const [sizesRows, statusRows, maxConnRows, verRows] = await withDeadline(
				queries,
				8_000,
				`mysql [${targetName}] stats query`
			);

			const status: Record<string, string> = {};
			for (const r of statusRows) {
				status[String(r.Variable_name)] = String(r.Value);
			}
			const maxConn = Number((maxConnRows[0]?.Value as string) ?? '0');

			// Cache hit rate = 1 - reads / read_requests. Both counters
			// are cumulative since server start; ratio is meaningful as
			// a long-window average.
			const reads = Number(status.Innodb_buffer_pool_reads ?? '0');
			const requests = Number(status.Innodb_buffer_pool_read_requests ?? '0');
			const hitRate = requests > 0 ? Math.max(0, 1 - reads / requests) : undefined;

			const dbs = sizesRows.map((r) => ({
				name: String(r.db),
				bytes: Number(r.bytes)
			}));
			const totalBytes = dbs.reduce((a, b) => a + b.bytes, 0);

			record({
				...baseAudit,
				outcome: 'ok',
				durationMs: Math.round(performance.now() - start)
			});
			return {
				ok: true,
				host,
				version: String(verRows[0]?.v ?? ''),
				uptimeSec: Number(status.Uptime ?? '0'),
				dbs,
				totalBytes,
				connections: {
					current: Number(status.Threads_connected ?? '0'),
					max: maxConn
				},
				slowQueries: Number(status.Slow_queries ?? '0'),
				bufferPoolHitRate: hitRate
			};
		} catch (err) {
			broken = true;
			throw err;
		} finally {
			if (broken) conn.destroy();
			else conn.release();
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
			connections: { current: 0, max: 0 },
			slowQueries: 0
		};
	}
}

// ── Per-db drill-in ──────────────────────────────────────────────────────────

export type MysqlTable = {
	name: string;
	engine: string | null;
	bytes: number;
	rowCount: number;
};

export type MysqlDbDetail = {
	ok: boolean;
	error?: string;
	dbName: string;
	totalBytes: number;
	tables: MysqlTable[];
};

export async function fetchMysqlDbDetail(
	targetName: string,
	uri: string,
	dbName: string,
	session: Session | null,
	cluster?: string
): Promise<MysqlDbDetail> {
	const pool = getPool(targetName, uri);
	const baseAudit = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster: cluster ?? 'external',
		action: 'db-stats-mysql-drill',
		target: { kind: 'Database', name: targetName, db: dbName }
	};
	const start = performance.now();
	try {
		const conn = await withDeadline(
			pool.getConnection(),
			8_000,
			`mysql [${targetName}/${dbName}] connect`,
			(c) => c.release()
		);
		// A timed-out query keeps running on this connection — destroy it
		// rather than hand a busy connection back to the pool.
		let broken = false;
		try {
			const [rows] = await withDeadline(
				conn.query<mysql.RowDataPacket[]>(
					`SELECT table_name AS tname, engine,
					COALESCE(data_length + index_length, 0) AS bytes,
					COALESCE(table_rows, 0) AS rcount
				FROM information_schema.tables
				WHERE table_schema = ?
				ORDER BY bytes DESC
				LIMIT 100`,
					[dbName]
				),
				8_000,
				`mysql [${targetName}/${dbName}] tables`
			);
			const tables: MysqlTable[] = rows.map((r) => ({
				name: String(r.tname),
				engine: r.engine == null ? null : String(r.engine),
				bytes: Number(r.bytes),
				rowCount: Number(r.rcount)
			}));
			const totalBytes = tables.reduce((a, b) => a + b.bytes, 0);
			record({
				...baseAudit,
				outcome: 'ok',
				durationMs: Math.round(performance.now() - start)
			});
			return { ok: true, dbName, totalBytes, tables };
		} catch (err) {
			broken = true;
			throw err;
		} finally {
			if (broken) conn.destroy();
			else conn.release();
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
			tables: []
		};
	}
}
