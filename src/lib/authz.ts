import { error, redirect } from '@sveltejs/kit';
import type { Session } from '@auth/core/types';

// Project-role keys as defined in the Zitadel Application
// (platform repo, modules/zitadel-app; role_keys: platform_admin /
// platform_sre / user). Anyone outside admin+sre is bounced from the
// dashboard surfaces.
//
// Per-cluster overrides are role keys of the shape
//   cluster_<name>_admin / cluster_<name>_sre
// (e.g. `cluster_home_admin`). When a cluster-scoped role is
// configured in Zitadel, it grants access only to that cluster,
// overriding the global platform_* roles for write decisions on
// the named cluster. Users with both global + cluster roles get the
// union — the cluster role can elevate (sre→admin) but never
// demote what the platform role already grants.
//
// Per-namespace overrides are role keys of the shape
//   namespace_<name>_admin / namespace_<name>_sre
// (e.g. `namespace_mail_admin`). They grant access to one
// namespace inside any cluster the user can reach (in practice,
// they're cluster-implicit because the dash runs against one
// cluster at a time per route). Reads are scoped to that namespace;
// writes to namespaced resources in that namespace are allowed; any
// cluster-scoped action (CRD definitions, Nodes, ClusterRoles) is
// denied. The namespace name in the role key is the literal k8s
// namespace string, so renames need a Zitadel-side update.
export const ROLE_ADMIN = 'platform_admin';
export const ROLE_SRE = 'platform_sre';

export function hasRole(session: Session | null | undefined, role: string): boolean {
	return !!session?.roles?.includes(role);
}

function clusterRoleAdmin(cluster: string): string {
	return `cluster_${cluster}_admin`;
}
function clusterRoleSre(cluster: string): string {
	return `cluster_${cluster}_sre`;
}
function namespaceRoleAdmin(namespace: string): string {
	return `namespace_${namespace}_admin`;
}
function namespaceRoleSre(namespace: string): string {
	return `namespace_${namespace}_sre`;
}

// Read access. `cluster` narrows to a cluster-scoped role; `namespace`
// further narrows to a namespace-scoped role. Namespace-only operators
// must always pass `namespace` — without it canRead returns false so
// data-fetching endpoints (watch streams, list-all-ns calls) can't
// be tricked into cluster-wide reads. The /k8s/[cluster]/+layout
// uses `canEnterClusterSurface` instead to decide whether to render
// the cluster surface at all.
export function canRead(
	session: Session | null | undefined,
	cluster?: string,
	namespace?: string
): boolean {
	if (hasRole(session, ROLE_ADMIN) || hasRole(session, ROLE_SRE)) return true;
	if (cluster) {
		if (hasRole(session, clusterRoleAdmin(cluster)) || hasRole(session, clusterRoleSre(cluster)))
			return true;
	}
	if (namespace) {
		if (
			hasRole(session, namespaceRoleAdmin(namespace)) ||
			hasRole(session, namespaceRoleSre(namespace))
		)
			return true;
	}
	return false;
}

// Layout-only gate: should we render the /k8s/<cluster> surface at
// all for this session? True for global / cluster-wide readers, AND
// for namespace-only operators (so the sidebar/topbar still shows
// up — the layout itself filters the namespace list to what they
// can actually see). Pages and endpoints inside the surface still
// re-check with a concrete namespace via canRead/canWrite.
export function canEnterClusterSurface(
	session: Session | null | undefined,
	cluster: string
): boolean {
	if (canRead(session, cluster)) return true;
	return hasAnyNamespaceRole(session);
}

// Write access. Same shape as canRead but only `*_admin` flavours
// grant it (sre is read-only).
export function canWrite(
	session: Session | null | undefined,
	cluster?: string,
	namespace?: string
): boolean {
	if (hasRole(session, ROLE_ADMIN)) return true;
	if (cluster && hasRole(session, clusterRoleAdmin(cluster))) return true;
	if (namespace && hasRole(session, namespaceRoleAdmin(namespace))) return true;
	return false;
}

// True if the user has any `namespace_<x>_admin/sre` role. Used by
// canRead to decide "should we show the cluster surface at all" for
// a user whose only access is namespace-scoped.
export function hasAnyNamespaceRole(session: Session | null | undefined): boolean {
	const roles = session?.roles ?? [];
	for (const r of roles) {
		if (r.startsWith('namespace_') && (r.endsWith('_admin') || r.endsWith('_sre'))) return true;
	}
	return false;
}

// Pull every namespace name embedded in `namespace_<x>_admin/sre`
// roles. Used to filter the sidebar / list pages to the namespaces
// the user can actually see when they don't hold a global or
// cluster-wide read role. Returns a deduped, sorted array.
export function namespacesFromRoles(session: Session | null | undefined): string[] {
	const out = new Set<string>();
	for (const r of session?.roles ?? []) {
		if (!r.startsWith('namespace_')) continue;
		// Strip prefix and the trailing _admin / _sre suffix to recover
		// the namespace name. A namespace name can contain underscores
		// (k8s allows hyphens but not underscores — but be lenient).
		const m = /^namespace_(.+)_(admin|sre)$/.exec(r);
		if (m) out.add(m[1]);
	}
	return [...out].sort();
}

// "What namespaces can this session see in this cluster?"
// Returns 'all' for global / cluster-wide read roles (the existing
// behaviour), or a concrete list for ns-only users. Page loaders
// hand this to the UI so the sidebar can filter.
export function accessibleNamespaces(
	session: Session | null | undefined,
	cluster: string
): 'all' | string[] {
	if (hasRole(session, ROLE_ADMIN) || hasRole(session, ROLE_SRE)) return 'all';
	if (hasRole(session, clusterRoleAdmin(cluster)) || hasRole(session, clusterRoleSre(cluster)))
		return 'all';
	return namespacesFromRoles(session);
}

// Convenience for write-decision against the namespace list above.
export function canWriteNamespace(
	session: Session | null | undefined,
	cluster: string,
	namespace: string
): boolean {
	return canWrite(session, cluster, namespace);
}

// "What namespaces can this session WRITE to in this cluster?"
// Returns 'all' for global / cluster-wide admin roles, or a concrete
// list for ns-only admins. SREs and read-only roles get []. Used by
// the layout to feed list pages a per-row write toggle.
export function writableNamespaces(
	session: Session | null | undefined,
	cluster: string
): 'all' | string[] {
	if (hasRole(session, ROLE_ADMIN)) return 'all';
	if (hasRole(session, clusterRoleAdmin(cluster))) return 'all';
	const out = new Set<string>();
	for (const r of session?.roles ?? []) {
		const m = /^namespace_(.+)_admin$/.exec(r);
		if (m) out.add(m[1]);
	}
	return [...out].sort();
}

// Server-side gate. Unauthenticated users land on `/` to sign in;
// authenticated-but-unauthorised users get a hard 403 instead of a
// silent redirect — the latter looks like a broken link, the former
// makes the missing role obvious. Per-cluster `cluster` arg is
// optional; when present, cluster-scoped (and namespace-scoped) roles
// are also accepted. The layout passes `forCluster: true` when it
// just wants to know if the surface should render — that allows
// namespace-only operators to enter even though they can't read the
// cluster wide.
export function requireRead(
	session: Session | null | undefined,
	cluster?: string,
	namespace?: string,
	opts?: { forCluster?: boolean }
): void {
	if (!session?.user) throw redirect(303, '/');
	const ok = opts?.forCluster && cluster
		? canEnterClusterSurface(session, cluster)
		: canRead(session, cluster, namespace);
	if (!ok) {
		throw error(
			403,
			'Missing platform_admin/platform_sre, cluster_<x>_admin/sre, or namespace_<x>_admin/sre role'
		);
	}
}

export function requireWrite(
	session: Session | null | undefined,
	cluster?: string,
	namespace?: string
): void {
	if (!session?.user) throw redirect(303, '/');
	if (!canWrite(session, cluster, namespace)) {
		throw error(
			403,
			'platform_admin, cluster_<x>_admin, or namespace_<x>_admin role required for this action'
		);
	}
}
