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
	const myStuck = stuck?.perCluster.find((c) => c.cluster === cluster) ?? null;

	return {
		session,
		cluster,
		apiRing,
		stuck: myStuck,
		grafanaUrl: 'https://grafana.ipsupport.us'
	};
};
