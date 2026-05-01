import type { PageServerLoad } from './$types';
import { requireWrite } from '$lib/authz';
import { snapshot } from '$lib/k8s-metrics.server';

// Self-monitoring view of the in-memory ring buffer of k8s API call
// latencies. Admin-only — operational tool, not for SRE eyes.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireWrite(session);
	return { session, metrics: snapshot() };
};
