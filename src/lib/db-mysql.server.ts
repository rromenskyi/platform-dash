import mysql from 'mysql2/promise';
import { record } from './audit.server';
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

const pools = new Map<string, mysql.Pool>();

function getPool(targetName: string, uri: string): mysql.Pool {
	const cached = pools.get(targetName);
	if (cached) return cached;
	const pool = mysql.createPool({
		uri,
		connectionLimit: 2,
		connectTimeout: 5_000
	});
	pools.set(targetName, pool);
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
		const conn = await pool.getConnection();
		try {
			const [sizesRows] = await conn.query<mysql.RowDataPacket[]>(
				`SELECT table_schema AS db, COALESCE(SUM(data_length + index_length), 0) AS bytes
				FROM information_schema.tables
				GROUP BY table_schema
				ORDER BY bytes DESC`
			);
			const [statusRows] = await conn.query<mysql.RowDataPacket[]>(
				`SHOW GLOBAL STATUS WHERE Variable_name IN
				('Uptime','Threads_connected','Slow_queries',
				 'Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads')`
			);
			const [maxConnRows] = await conn.query<mysql.RowDataPacket[]>(
				`SHOW VARIABLES LIKE 'max_connections'`
			);
			const [verRows] = await conn.query<mysql.RowDataPacket[]>(`SELECT VERSION() AS v`);

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
		} finally {
			conn.release();
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
