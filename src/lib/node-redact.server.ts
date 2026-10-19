import { core } from './k8s.server';
import { time } from './k8s-metrics.server';
import { withDeadline } from './index';

// Hide node identity from namespace-scoped users in free text (event
// messages) and in addresses (host-network pod IPs, endpoint IPs).
// Node names and addresses come from a per-cluster cache refreshed in
// the background (stale-while-revalidate), so callers never block on it
// for long.

const TTL_MS = 60_000;
const FETCH_DEADLINE_MS = 4_000;
export const NODE_PLACEHOLDER = '‹node›';

type NodeIds = { names: string[]; addresses: Set<string>; at: number };
const cache = new Map<string, NodeIds>();
const inFlight = new Map<string, Promise<NodeIds>>();

async function fetchIds(cluster: string): Promise<NodeIds> {
	const res = await withDeadline(
		time(`${cluster}/listNode`, () => core(cluster).listNode()),
		FETCH_DEADLINE_MS,
		`${cluster} listNode (redact)`
	);
	const names: string[] = [];
	const addresses = new Set<string>();
	for (const n of res.items) {
		if (n.metadata?.name) names.push(n.metadata.name);
		for (const a of n.status?.addresses ?? []) {
			if (a.address) {
				addresses.add(a.address);
				if (a.type === 'Hostname') names.push(a.address);
			}
		}
	}
	// Longest first so "node-10" wins over "node-1".
	names.sort((a, b) => b.length - a.length);
	return { names: [...new Set(names)], addresses, at: Date.now() };
}

async function nodeIds(cluster: string): Promise<NodeIds | null> {
	const cached = cache.get(cluster);
	if (cached && Date.now() - cached.at < TTL_MS) return cached;
	let p = inFlight.get(cluster);
	if (!p) {
		p = fetchIds(cluster)
			.then((ids) => {
				cache.set(cluster, ids);
				return ids;
			})
			.finally(() => inFlight.delete(cluster));
		inFlight.set(cluster, p);
	}
	if (cached) return cached; // stale now, fresh next time
	return p.catch(() => null);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type Redactor = { text: (s: string) => string; ip: (s: string | undefined) => string | undefined };

export function makeRedactor(names: string[], addresses: Set<string>): Redactor {
	const terms = [...names, ...addresses].filter(Boolean);
	const re = terms.length
		? new RegExp(`(?<![\\w.-])(?:${terms.map(escape).join('|')})(?![\\w-])`, 'g')
		: null;
	return {
		text: (s) =>
			(re ? s.replace(re, NODE_PLACEHOLDER) : s)
				// Scheduler messages give away the cluster's node count.
				.replace(/\b\d+\/\d+ nodes are available/g, 'no nodes are available'),
		ip: (s) => (s && addresses.has(s) ? undefined : s)
	};
}

const identity: Redactor = { text: (s) => s, ip: (s) => s };

// Redactor for a session: identity for cluster-wide readers, node
// scrubbing otherwise.
export async function redactorFor(cluster: string, clusterWide: boolean): Promise<Redactor> {
	if (clusterWide) return identity;
	const ids = await nodeIds(cluster);
	return ids ? makeRedactor(ids.names, ids.addresses) : makeRedactor([], new Set());
}
