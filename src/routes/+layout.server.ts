import type { LayoutServerLoad } from './$types';
import { canRead, canWrite } from '$lib/authz';
import { defaultCluster, listClusters } from '$lib/clusters.server';
import { materialize } from '$lib/resource';
import { buildAllTrees } from '$lib/resource-tree-k8s.server';
import { ensureFresh as ensureDbTargetsFresh } from '$lib/db-targets.server';
import { snapshot as k8sMetricsSnapshot } from '$lib/k8s-metrics.server';
import { incidentSummary } from '$lib/incident-summary.server';

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
	// without this fallback they'd see no sidebar / api pill / stuck
	// pill at all and have to navigate by typing URLs. Treat them as
	// readers if they can read at least one configured cluster.
	const reader =
		canRead(session) || listClusters().some((c) => canRead(session, c));
	// Tree is read-only metadata about what's configured — only build
	// it when the user actually has access to anything, so unauthorised
	// pages don't waste cycles. Refresh the DB targets registry first
	// so the sidebar shows whatever the operator has in the registry
	// CM on first paint.
	let tree: Awaited<ReturnType<typeof materialize>> = [];
	if (reader) {
		await ensureDbTargetsFresh();
		tree = await materialize(buildAllTrees());
	}
	// Lightweight snapshot for the topbar status pill — only counts +
	// p95 + recent error count. Cheap (in-memory ring snapshot).
	const m = reader ? k8sMetricsSnapshot() : null;
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
		canRead: reader,
		canWrite: canWrite(session),
		defaultCluster: defaultCluster(),
		tree,
		apiHealth,
		stuck
	};
};
