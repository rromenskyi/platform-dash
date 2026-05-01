import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { env } from '$env/dynamic/private';
import { core } from './k8s.server';
import { defaultCluster } from './clusters.server';

// DB target registry. Two sources merged at refresh time:
//
//   1) ConfigMap (primary, discovery-friendly) — `data.targets.yaml`
//      is a list of {name, kind, cluster?, label?, secret:{name,key,
//      namespace?}}. Secret refs are resolved by reading the Secret
//      and decoding `data[secret.key]`. Operator manages targets by
//      editing one CM; no pod restart.
//
//   2) ENV (`DASH_DB_TARGETS_JSON`) — same shape but with `uriEnv`
//      pointing to a separate ENV var holding the URI. Kept for local
//      dev outside k8s and for cloud DBs whose creds aren't already
//      in a cluster Secret.
//
// ENV targets win on name conflict (debugging override). Cache TTL is
// 30s; pages call `await ensureFresh()` at the top of their loader.
//
// Security: the URI never crosses to the client. The dashboard's SA
// needs `configmaps get` on the registry CM and `secrets get` on each
// referenced Secret. Currently covered by the platform's wildcard
// read rule — narrowing to specific resource_names would require
// per-namespace Roles which the platform module doesn't ship yet.

export type DbKind = 'postgres' | 'redis';

export type DbTarget = {
	name: string;
	kind: DbKind;
	cluster?: string;
	label?: string;
	source: 'env' | 'configmap';
	uri: string | null;
	// Human-readable diagnostic when `uri` is null (e.g. "Secret
	// platform/foo not found" or "ENV PG_URI_X not set").
	uriHint?: string;
};

type EnvTarget = {
	name?: string;
	kind?: DbKind;
	uriEnv?: string;
	cluster?: string;
	label?: string;
};

type CmTarget = {
	name?: string;
	kind?: DbKind;
	cluster?: string;
	label?: string;
	secret?: { name?: string; key?: string; namespace?: string };
};

const TTL_MS = 30_000;
const CONFIGMAP_NAME = env.DASH_DB_CONFIGMAP_NAME || 'platform-dash-db-targets';

let cache: Map<string, DbTarget> = new Map();
let lastRefresh = 0;
let inFlight: Promise<void> | null = null;

function podNamespace(): string {
	try {
		return readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').trim();
	} catch {
		return env.POD_NAMESPACE || env.DASH_DB_CONFIGMAP_NAMESPACE || 'default';
	}
}

function configMapNamespace(): string {
	return env.DASH_DB_CONFIGMAP_NAMESPACE || podNamespace();
}

function fromEnv(): DbTarget[] {
	const raw = env.DASH_DB_TARGETS_JSON;
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: DbTarget[] = [];
		const seen = new Set<string>();
		for (const t of parsed as EnvTarget[]) {
			if (!t?.name || !t?.kind || !t?.uriEnv) continue;
			if (t.kind !== 'postgres' && t.kind !== 'redis') continue;
			if (seen.has(t.name)) continue;
			seen.add(t.name);
			const uri = env[t.uriEnv];
			out.push({
				name: t.name,
				kind: t.kind,
				cluster: t.cluster,
				label: t.label,
				source: 'env',
				uri: uri ?? null,
				uriHint: uri ? undefined : `ENV ${t.uriEnv} not set`
			});
		}
		return out;
	} catch (err) {
		console.error('failed to parse DASH_DB_TARGETS_JSON', err);
		return [];
	}
}

async function fromConfigMap(): Promise<DbTarget[]> {
	const cmNs = configMapNamespace();
	const cluster = defaultCluster();
	let cm;
	try {
		cm = await core(cluster).readNamespacedConfigMap({
			name: CONFIGMAP_NAME,
			namespace: cmNs
		});
	} catch (err) {
		const code =
			typeof err === 'object' && err !== null && 'code' in err
				? (err as { code: number }).code
				: 0;
		if (code === 404) return []; // CM not present — operator hasn't created it yet
		console.warn(`db-targets: read CM ${cmNs}/${CONFIGMAP_NAME} failed`, err);
		return [];
	}

	const raw = (cm.data?.['targets.yaml'] ?? cm.data?.['targets.json'] ?? '') as string;
	if (!raw.trim()) return [];

	let list: CmTarget[];
	try {
		const parsed = parseYaml(raw);
		if (!Array.isArray(parsed)) return [];
		list = parsed as CmTarget[];
	} catch (err) {
		console.warn(`db-targets: parse ${CONFIGMAP_NAME} targets.yaml failed`, err);
		return [];
	}

	// Resolve each target's Secret in parallel. Per-target failures
	// surface inline in `uriHint` so the index page can render them.
	const out: DbTarget[] = (
		await Promise.all(
			list.map(async (t): Promise<DbTarget | null> => {
				if (!t?.name || !t?.kind || !t?.secret?.name || !t?.secret?.key) return null;
				if (t.kind !== 'postgres' && t.kind !== 'redis') return null;
				const secNs = t.secret.namespace || cmNs;
				try {
					const sec = await core(cluster).readNamespacedSecret({
						name: t.secret.name,
						namespace: secNs
					});
					const b64 = (sec.data ?? {})[t.secret.key];
					if (!b64) {
						return {
							name: t.name,
							kind: t.kind,
							cluster: t.cluster,
							label: t.label,
							source: 'configmap',
							uri: null,
							uriHint: `Secret ${secNs}/${t.secret.name} has no key "${t.secret.key}"`
						};
					}
					const uri = Buffer.from(b64, 'base64').toString('utf8').trim();
					return {
						name: t.name,
						kind: t.kind,
						cluster: t.cluster,
						label: t.label,
						source: 'configmap',
						uri,
						uriHint: undefined
					};
				} catch (err) {
					const code =
						typeof err === 'object' && err !== null && 'code' in err
							? (err as { code: number }).code
							: 0;
					const msg =
						code === 404
							? `Secret ${secNs}/${t.secret.name} not found`
							: (err as Error).message;
					return {
						name: t.name,
						kind: t.kind,
						cluster: t.cluster,
						label: t.label,
						source: 'configmap',
						uri: null,
						uriHint: msg
					};
				}
			})
		)
	).filter((t): t is DbTarget => t !== null);

	return out;
}

async function refresh(): Promise<void> {
	const next = new Map<string, DbTarget>();
	// CM targets first; ENV targets overwrite on name conflict (so a
	// developer can shadow a production target locally).
	for (const t of await fromConfigMap()) next.set(t.name, t);
	for (const t of fromEnv()) next.set(t.name, t);
	cache = next;
	lastRefresh = Date.now();
}

export async function ensureFresh(): Promise<void> {
	const age = Date.now() - lastRefresh;
	// First call (lastRefresh=0) always refreshes; later calls within
	// the TTL window short-circuit. Concurrent callers share the same
	// in-flight promise to avoid a thundering-herd CM read.
	if (lastRefresh > 0 && age < TTL_MS) return;
	if (inFlight) return inFlight;
	inFlight = refresh().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

export function listTargets(): DbTarget[] {
	return Array.from(cache.values());
}

export function getTarget(name: string): DbTarget | undefined {
	return cache.get(name);
}

// Display the host portion of a URI without exposing userinfo. Used
// in the UI to show where a target points without leaking creds.
export function safeHost(uri: string | null): string {
	if (!uri) return '—';
	try {
		const u = new URL(uri);
		return u.port ? `${u.hostname}:${u.port}` : u.hostname;
	} catch {
		return '—';
	}
}
