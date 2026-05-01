import Redis from 'ioredis';
import { record } from './audit.server';
import type { Session } from '@auth/core/types';

// Redis stats via INFO. ACL needs `+@read +info` for the dashboard
// user. One client per target, kept open across requests.
//
// We do NOT call `KEYS *` or scan keyspaces — the INFO output already
// surfaces per-db key counts via `db0:keys=N,expires=...`.

export type RedisStats = {
	ok: boolean;
	error?: string;
	host?: string;
	version?: string;
	mode?: string;
	role?: string;
	uptimeSec?: number;
	usedBytes: number;
	maxBytes: number;
	clients: number;
	evictedKeys: number;
	keyspaceHits: number;
	keyspaceMisses: number;
	keyspace: Array<{ db: string; keys: number; expires: number }>;
};

const clients = new Map<string, Redis>();

function getClient(targetName: string, uri: string): Redis {
	const cached = clients.get(targetName);
	if (cached) return cached;
	const c = new Redis(uri, {
		maxRetriesPerRequest: 1,
		connectTimeout: 5_000,
		// We poll periodically; lazyConnect=false (default) is fine.
		// reconnectOnError: keep default
		enableReadyCheck: false
	});
	c.on('error', (err) => {
		// ioredis emits errors loudly; one log per error class would
		// drown the console under network blips, so we keep this short.
		console.warn(`redis [${targetName}] error: ${err.message}`);
	});
	clients.set(targetName, c);
	return c;
}

// INFO returns "# Section\nkey:value\n..." sections separated by
// blank lines. We collapse it to a flat key→value map; sections like
// `# Keyspace` use sub-keys (db0:keys=N,expires=...) which we parse
// out separately.
function parseInfo(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		if (!line || line.startsWith('#')) continue;
		const idx = line.indexOf(':');
		if (idx < 0) continue;
		out[line.slice(0, idx)] = line.slice(idx + 1);
	}
	return out;
}

function parseKeyspace(raw: string): RedisStats['keyspace'] {
	const out: RedisStats['keyspace'] = [];
	const lines = raw.split(/\r?\n/);
	let inKeyspace = false;
	for (const line of lines) {
		if (line === '# Keyspace') {
			inKeyspace = true;
			continue;
		}
		if (line.startsWith('#')) {
			inKeyspace = false;
			continue;
		}
		if (!inKeyspace || !line.includes(':')) continue;
		const [db, val] = line.split(':');
		const parts = Object.fromEntries(val.split(',').map((p) => p.split('=')));
		out.push({
			db,
			keys: Number(parts.keys ?? 0),
			expires: Number(parts.expires ?? 0)
		});
	}
	return out;
}

export async function fetchRedisStats(
	targetName: string,
	uri: string,
	session: Session | null,
	cluster?: string
): Promise<RedisStats> {
	const c = getClient(targetName, uri);
	const baseAudit = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster: cluster ?? 'external',
		action: 'db-stats-redis',
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
		const raw = await c.info();
		const flat = parseInfo(raw);
		record({
			...baseAudit,
			outcome: 'ok',
			durationMs: Math.round(performance.now() - start)
		});
		return {
			ok: true,
			host,
			version: flat.redis_version,
			mode: flat.redis_mode,
			role: flat.role,
			uptimeSec: Number(flat.uptime_in_seconds ?? 0),
			usedBytes: Number(flat.used_memory ?? 0),
			maxBytes: Number(flat.maxmemory ?? 0),
			clients: Number(flat.connected_clients ?? 0),
			evictedKeys: Number(flat.evicted_keys ?? 0),
			keyspaceHits: Number(flat.keyspace_hits ?? 0),
			keyspaceMisses: Number(flat.keyspace_misses ?? 0),
			keyspace: parseKeyspace(raw)
		};
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
			usedBytes: 0,
			maxBytes: 0,
			clients: 0,
			evictedKeys: 0,
			keyspaceHits: 0,
			keyspaceMisses: 0,
			keyspace: []
		};
	}
}
