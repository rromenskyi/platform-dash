import type { PageServerLoad } from './$types';
import { requireWrite } from '$lib/authz';
import { auditSnapshot } from '$lib/audit.server';

// Last 1000 audit events from the in-memory ring. Admin-only — same
// gate as /admin/metrics. Loki / kubectl logs remain authoritative
// for anything older than the ring window or surviving a pod restart.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireWrite(session);
	return { session, events: auditSnapshot() };
};
