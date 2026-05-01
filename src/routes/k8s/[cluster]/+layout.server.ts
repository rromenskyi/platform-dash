import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { requireRead, canWrite } from '$lib/authz';
import { core } from '$lib/k8s.server';
import { isKnownCluster, listClusters } from '$lib/clusters.server';
import { time } from '$lib/k8s-metrics.server';

// One gate for every /k8s/[cluster]/* route. Validates the cluster
// param (404 on unknown) so child handlers can assume a real name.
// Also fetches the namespace list once per request for the global
// selector and surfaces the current ?ns= filter to the UI.
export const load: LayoutServerLoad = async (event) => {
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	if (!isKnownCluster(cluster)) {
		throw error(404, `Unknown cluster "${cluster}". Configured: ${listClusters().join(', ')}`);
	}
	// Cluster is known by the time we gate — pass it so cluster-scoped
	// roles (cluster_<name>_admin/_sre) can grant access on top of the
	// global platform_* roles.
	requireRead(session, cluster);

	let namespaces: string[] = [];
	try {
		const res = await time(`${cluster}/listNamespace`, () => core(cluster).listNamespace());
		namespaces = res.items
			.map((n) => n.metadata?.name)
			.filter((n): n is string => !!n)
			.sort();
	} catch (err) {
		console.warn(`list namespaces (${cluster}) failed`, err);
	}

	return {
		session,
		canWrite: canWrite(session, cluster),
		cluster,
		clusters: listClusters(),
		namespaces,
		ns: event.url.searchParams.get('ns') || ''
	};
};
