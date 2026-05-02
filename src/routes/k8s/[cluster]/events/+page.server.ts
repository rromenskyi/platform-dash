import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { canRead } from '$lib/authz';

export type EventRow = {
	type: string;
	reason: string;
	message: string;
	count: number;
	namespace: string;
	involved: string;
	firstSeen?: string;
	lastSeen?: string;
};

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const { cluster } = event.params;
	if (!session?.user) throw redirect(303, '/');
	if (!canRead(session, cluster)) throw redirect(303, '/');

	const ns = event.url.searchParams.get('ns') || '';

	// Namespace list for the dropdown — best-effort. SRE without
	// cluster-wide list rights still gets the events page; the
	// dropdown just shows whatever namespace they're already in.
	let nsList: string[] = [];
	try {
		const nsRes = await time(`${cluster}/listNamespace`, () =>
			core(cluster).listNamespace()
		);
		nsList = nsRes.items
			.map((n) => n.metadata?.name)
			.filter((n): n is string => !!n)
			.sort();
	} catch {
		/* silent — surfaced via the events list error if relevant */
	}

	let rows: EventRow[] = [];
	let error: string | null = null;
	try {
		const res = ns
			? await time(`${cluster}/listNamespacedEvent`, () =>
					core(cluster).listNamespacedEvent({ namespace: ns })
				)
			: await time(`${cluster}/listEventForAllNamespaces`, () =>
					core(cluster).listEventForAllNamespaces()
				);
		rows = res.items
			.map((e) => ({
				type: e.type ?? '?',
				reason: e.reason ?? '?',
				message: e.message ?? '',
				count: e.count ?? 1,
				namespace: e.metadata?.namespace ?? e.involvedObject?.namespace ?? '?',
				involved: `${e.involvedObject?.kind ?? '?'}/${e.involvedObject?.name ?? '?'}`,
				firstSeen: e.firstTimestamp
					? new Date(e.firstTimestamp).toISOString()
					: e.eventTime
						? new Date(e.eventTime).toISOString()
						: undefined,
				lastSeen: e.lastTimestamp
					? new Date(e.lastTimestamp).toISOString()
					: e.eventTime
						? new Date(e.eventTime).toISOString()
						: undefined
			}))
			.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
	} catch (err) {
		console.error('list events failed', err);
		error = err instanceof Error ? err.message : String(err);
	}

	return { cluster, rows, error, namespaces: nsList, currentNs: ns };
};
