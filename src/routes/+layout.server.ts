import type { LayoutServerLoad } from './$types';
import { canRead, canWrite, hasAnyNamespaceRole } from '$lib/authz';
import { defaultCluster, listClusters } from '$lib/clusters.server';
import { materialize } from '$lib/resource';
import { buildAllTrees } from '$lib/resource-tree-k8s.server';
import { kickFresh as kickDbTargetsFresh } from '$lib/db-targets.server';
import { snapshot as k8sMetricsSnapshot } from '$lib/k8s-metrics.server';
import { incidentSummary } from '$lib/incident-summary.server';
import { BUILD_SHA, BUILD_SHA_SHORT, BUILD_TIME, COMMIT_URL } from '$lib/build-info';

// Surface the Auth.js session on every page via $page.data.session.
// Keeping this in a layout (not per-page) means the topbar can show
// "Sign in" / "Sign out" without each route having to re-fetch.
// canRead/canWrite are derived once here so the sidebar + button
// visibility checks don't have to repeat the role lookup.
// defaultCluster is exposed so sidebar nav can land users on
// /k8s/<default>/... when they're not already inside a cluster path.
export const load: LayoutServerLoad = async (event) => {
	const session = await event.locals.auth();
	// `canRead(session)` checks global roles only; cluster_<name>_sre
	// users have access to a specific cluster but no global role, and
	// namespace_<name>_sre/admin users have access to one namespace.
	// Treat them all as readers so the layout, sidebar and topbar pill
	// render — per-page loaders do the actual ns-scoped checks.
	const reader =
		canRead(session) ||
		listClusters().some((c) => canRead(session, c)) ||
		hasAnyNamespaceRole(session);
	// Tree is read-only metadata about what's configured — only build
	// it when the user actually has access to anything, so unauthorised
	// pages don't waste cycles. Refresh the DB targets registry first
	// so the sidebar shows whatever the operator has in the registry
	// CM on first paint.
	let tree: Awaited<ReturnType<typeof materialize>> = [];
	if (reader) {
		// Background refresh — never await. Slow CM/Secret reads
		// would otherwise block every nav.
		kickDbTargetsFresh();
		tree = await materialize(buildAllTrees((c) => canRead(session, c)));
	}
	// Lightweight snapshot for the topbar status pill — only counts +
	// p95 + recent error count. Cheap (in-memory ring snapshot).
	// 5-minute window so an error from earlier in the session doesn't
	// sit in the pill forever, looking like an active fault. Full
	// (whole-ring) snapshot is still available on /admin/metrics.
	const TOPBAR_WINDOW_MS = 5 * 60 * 1000;
	const m = reader ? k8sMetricsSnapshot(TOPBAR_WINDOW_MS) : null;
	const apiHealth = m
		? {
				count: m.count,
				errors: m.errors,
				p95: m.p95
			}
		: null;
	// Stuck-state pill — failing pods + bad nodes per cluster the user
	// can read. Sync stale-while-revalidate: returns the cached
	// snapshot (or null on cold start) immediately and kicks a
	// background refresh when expired. Layout never blocks on a
	// k8s call here, even if the apiserver is slow / unreachable.
	const stuck = reader ? incidentSummary((c) => canRead(session, c)) : null;
	return {
		session,
		// Build identity only for signed-in users — it's a version
		// fingerprint, and inlining it client-side shipped it to anyone.
		build: session?.user
			? { sha: BUILD_SHA, short: BUILD_SHA_SHORT, time: BUILD_TIME, url: COMMIT_URL }
			: null,
		canRead: reader,
		canWrite: canWrite(session),
		defaultCluster: defaultCluster(),
		tree,
		apiHealth,
		stuck
	};
};
