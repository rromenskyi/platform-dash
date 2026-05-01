import type { PageServerLoad } from './$types';
import { requireRead } from '$lib/authz';
import { listTargets, resolveUri, safeHost } from '$lib/db-targets.server';

export type DbCard = {
	name: string;
	kind: 'postgres' | 'redis';
	cluster?: string;
	label: string;
	host: string;
	hasUri: boolean;
};

// DB index — one card per configured target. Reachability is NOT
// probed here (would gang-stress every DB on every page load); the
// per-target detail page does the actual stat fetch.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);

	const cards: DbCard[] = listTargets().map((t) => {
		const uri = resolveUri(t);
		return {
			name: t.name,
			kind: t.kind,
			cluster: t.cluster,
			label: t.label ?? `${t.kind} / ${t.name}`,
			host: safeHost(uri),
			hasUri: !!uri
		};
	});

	return { cards };
};
