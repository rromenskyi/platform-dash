import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { requireRead, canWrite, accessibleNamespaces, writableNamespaces } from '$lib/authz';
import { core } from '$lib/k8s.server';
import { isKnownCluster, listClusters } from '$lib/clusters.server';
import { time } from '$lib/k8s-metrics.server';

// Stale-while-revalidate cache for the namespace list — without it,
// every nav inside /k8s/<c>/ blocked on listNamespace, and a slow
// apiserver hung the whole cluster surface.

const NS_TTL_MS = 30_000;
const NS_TIMEOUT_MS = 3_000;
type NsCache = { at: number; namespaces: string[] };
const nsCache = new Map<string, NsCache>();
const nsInFlight = new Map<string, Promise<string[]>>();

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			}
		);
	});
}

async function listNs(cluster: string): Promise<string[]> {
	const cached = nsCache.get(cluster);
	const fresh = cached && Date.now() - cached.at < NS_TTL_MS;
	if (fresh) return cached!.namespaces;

	if (!nsInFlight.has(cluster)) {
		const p = withTimeout(
			time(`${cluster}/listNamespace`, () => core(cluster).listNamespace()),
			NS_TIMEOUT_MS,
			`${cluster}/listNamespace`
		)
			.then((res) => {
				const namespaces = res.items
					.map((n) => n.metadata?.name)
					.filter((n): n is string => !!n)
					.sort();
				nsCache.set(cluster, { at: Date.now(), namespaces });
				return namespaces;
			})
			.catch((err) => {
				console.warn(`list namespaces (${cluster}) failed`, err);
				return cached?.namespaces ?? [];
			})
			.finally(() => {
				nsInFlight.delete(cluster);
			});
		nsInFlight.set(cluster, p);
	}

	// Stale cache: return immediately, the in-flight refresh will warm
	// the cache for the next request. Cold cache: await the in-flight
	// fetch (already capped at NS_TIMEOUT_MS) so the namespace selector
	// has options on the very first nav after pod restart.
	if (cached) return cached.namespaces;
	try {
		return await nsInFlight.get(cluster)!;
	} catch {
		return [];
	}
}

// One gate for every /k8s/[cluster]/* route. Validates the cluster
// param (404 on unknown) so child handlers can assume a real name.
// Surfaces the (cached) namespace list + current ?ns= filter to the UI.
export const load: LayoutServerLoad = async (event) => {
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	if (!isKnownCluster(cluster)) {
		throw error(404, `Unknown cluster "${cluster}". Configured: ${listClusters().join(', ')}`);
	}
	requireRead(session, cluster, undefined, { forCluster: true });

	const allNamespaces = await listNs(cluster);
	// For ns-only roles, hide every namespace they can't read so the
	// sidebar selector + cluster ns list don't even surface them.
	// Cluster-wide / global roles get the full list ('all').
	const accessible = accessibleNamespaces(session, cluster);
	const namespaces =
		accessible === 'all' ? allNamespaces : allNamespaces.filter((n) => accessible.includes(n));
	const accessibleList = accessible === 'all' ? null : accessible;

	const writable = writableNamespaces(session, cluster);
	const writableList = writable === 'all' ? null : writable;

	return {
		session,
		canWrite: canWrite(session, cluster),
		cluster,
		clusters: listClusters(),
		namespaces,
		// `null` means cluster-wide / global access; otherwise the
		// concrete list of namespaces the user has roles for. UI uses
		// this to lock the ns selector for ns-only operators.
		accessibleNamespaces: accessibleList,
		// `null` means cluster-wide write; otherwise the list of
		// namespaces the user can write to. Used by list pages to
		// decide which row-level action buttons to show.
		writableNamespaces: writableList,
		ns: event.url.searchParams.get('ns') || ''
	};
};
