import type { LayoutServerLoad } from './$types';

// Surface the Auth.js session on every page via $page.data.session.
// Keeping this in a layout (not per-page) means the topbar can show
// "Sign in" / "Sign out" without each route having to re-fetch.
export const load: LayoutServerLoad = async (event) => {
	return {
		session: await event.locals.auth()
	};
};
