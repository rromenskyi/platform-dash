import { env } from '$env/dynamic/private';

// DB target registry. Mirrors clusters.server.ts shape — a single
// JSON env var lists everything we know how to probe; per-target
// connection URI lives in a separate env var (so secret rotation
// only touches the URI, not the discovery list).
//
// Discovery is intentionally NOT done from k8s: cloud DBs (RDS,
// Aiven) aren't in any cluster, and we don't want to accidentally
// connect to a colocated DB that wasn't meant for the dashboard.
//
// Runtime contract for the platform-side provisioner:
//   DASH_DB_TARGETS_JSON='[
//     {"name":"platform-pg","kind":"postgres","cluster":"local",
//      "uriEnv":"PG_URI_PLATFORM","label":"platform / postgres"},
//     {"name":"platform-redis","kind":"redis","cluster":"local",
//      "uriEnv":"REDIS_URI_PLATFORM"},
//     {"name":"aws-rds-app","kind":"postgres",
//      "uriEnv":"PG_URI_AWS_APP","label":"aws prod"}
//   ]'
//   PG_URI_PLATFORM=postgres://dashboard_ro:xxx@host:5432/db?sslmode=require
//   REDIS_URI_PLATFORM=redis://default:xxx@host:6379/0
//
// The DB user (dashboard_ro) needs:
//   - Postgres: GRANT pg_monitor; CONNECT on the target dbs
//   - Redis: ACL with `+@read +info` only

export type DbKind = 'postgres' | 'redis';

export type DbTarget = {
	name: string;
	kind: DbKind;
	uriEnv: string;
	cluster?: string; // optional — cloud DBs have no cluster affinity
	label?: string;
};

function parseTargets(): DbTarget[] {
	const raw = env.DASH_DB_TARGETS_JSON;
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: DbTarget[] = [];
		const seen = new Set<string>();
		for (const t of parsed) {
			if (!t?.name || !t?.kind || !t?.uriEnv) continue;
			if (t.kind !== 'postgres' && t.kind !== 'redis') continue;
			if (seen.has(t.name)) continue;
			seen.add(t.name);
			out.push({
				name: t.name,
				kind: t.kind,
				uriEnv: t.uriEnv,
				cluster: t.cluster,
				label: t.label
			});
		}
		return out;
	} catch (err) {
		console.error('failed to parse DASH_DB_TARGETS_JSON', err);
		return [];
	}
}

const targets = parseTargets();

export function listTargets(): DbTarget[] {
	return targets;
}

export function getTarget(name: string): DbTarget | undefined {
	return targets.find((t) => t.name === name);
}

// Resolve the connection URI for a target by reading its uriEnv. The
// URI itself never crosses to the client — server-side only. Callers
// that need to display the host should pull it via parseURL() and
// strip credentials.
export function resolveUri(target: DbTarget): string | null {
	const uri = env[target.uriEnv];
	return typeof uri === 'string' && uri.length > 0 ? uri : null;
}

// Extract just the host:port for display. Strips userinfo so the UI
// never accidentally renders a password embedded in the URI.
export function safeHost(uri: string | null): string {
	if (!uri) return '—';
	try {
		const u = new URL(uri);
		return u.port ? `${u.hostname}:${u.port}` : u.hostname;
	} catch {
		return '—';
	}
}
