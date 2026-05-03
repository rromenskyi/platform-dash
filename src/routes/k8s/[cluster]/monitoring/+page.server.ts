import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canRead } from '$lib/authz';
import { snapshot } from '$lib/k8s-metrics.server';
import { incidentSummary } from '$lib/incident-summary.server';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) throw redirect(303, '/');
	const cluster = event.params.cluster;
	if (!canRead(session, cluster)) throw redirect(303, '/');

	// Reuse the in-memory rings / cluster summary that other admin
	// surfaces already populate. Cheap snapshots, no fresh k8s calls.
	const apiRing = snapshot();
	const stuck = incidentSummary((c) => canRead(session, c));
	// Don't reuse the field name `stuck` here — the root layout's
	// topbar pill reads `page.data.stuck` and expects the multi-cluster
	// summary shape (with `perCluster: [...]`). SvelteKit merges page
	// data over layout data, so naming the per-cluster slice `stuck`
	// shadowed the layout's value, the topbar's `s.perCluster.map(...)`
	// blew up at SSR with "Cannot read properties of undefined", and
	// the route 500'd.
	const clusterStuck = stuck?.perCluster.find((c) => c.cluster === cluster) ?? null;

	return {
		session,
		cluster,
		apiRing,
		clusterStuck,
		grafanaUrl: 'https://grafana.ipsupport.us'
	};
};
