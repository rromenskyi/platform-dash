import type { LayoutServerLoad } from './$types';
import { requireRead, canWrite } from '$lib/authz';

// One gate for every /k8s/* route. Each child page can still call
// `event.locals.auth()` for the session object, but the redirect-or-403
// decision lives here so per-page handlers stay focused on data.
export const load: LayoutServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);
	return {
		session,
		canWrite: canWrite(session)
	};
};
