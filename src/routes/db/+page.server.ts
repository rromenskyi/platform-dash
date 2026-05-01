import type { PageServerLoad } from './$types';
import { requireRead } from '$lib/authz';
import { ensureFresh, listTargets, safeHost } from '$lib/db-targets.server';

export type DbCard = {
	name: string;
	kind: 'postgres' | 'redis' | 'mysql';
	cluster?: string;
	label: string;
	host: string;
	hasUri: boolean;
	source: 'env' | 'configmap';
	uriHint?: string;
};

// DB index — one card per configured target. Reachability is NOT
// probed here (would gang-stress every DB on every page load); the
// per-target detail page does the actual stat fetch. ensureFresh()
// rebuilds the registry from the ConfigMap + ENV every 30s.
export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	requireRead(session);

	await ensureFresh();

	const cards: DbCard[] = listTargets().map((t) => ({
		name: t.name,
		kind: t.kind,
		cluster: t.cluster,
		label: t.label ?? `${t.kind} / ${t.name}`,
		host: safeHost(t.uri),
		hasUri: !!t.uri,
		source: t.source,
		uriHint: t.uriHint
	}));

	return { cards };
};
