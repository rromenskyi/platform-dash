import type { LayoutServerLoad } from './$types';
import { requireRead, canWrite } from '$lib/authz';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

// One gate for every /k8s/* route. Each child page can still call
// `event.locals.auth()` for the session object, but the redirect-or-403
// decision lives here so per-page handlers stay focused on data.
//
// Also fetches the namespace list once so the global namespace
// selector in the layout doesn't have to refetch on every page.
export const load: LayoutServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);

	let namespaces: string[] = [];
	try {
		const res = await time('listNamespace', () => core().listNamespace());
		namespaces = res.items
			.map((n) => n.metadata?.name)
			.filter((n): n is string => !!n)
			.sort();
	} catch (err) {
		// Non-fatal — selector falls back to a free-text input.
		console.warn('list namespaces (layout) failed', err);
	}

	return {
		session,
		canWrite: canWrite(session),
		namespaces,
		ns: event.url.searchParams.get('ns') || ''
	};
};
