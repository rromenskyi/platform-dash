import { error, redirect } from '@sveltejs/kit';
import type { Session } from '@auth/core/types';

// Project-role keys as defined in the Zitadel Application
// (~/platform/modules/zitadel-app, role_keys: platform_admin /
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

export function canRead(session: Session | null | undefined, cluster?: string): boolean {
	if (hasRole(session, ROLE_ADMIN) || hasRole(session, ROLE_SRE)) return true;
	if (cluster) {
		return hasRole(session, clusterRoleAdmin(cluster)) || hasRole(session, clusterRoleSre(cluster));
	}
	return false;
}

export function canWrite(session: Session | null | undefined, cluster?: string): boolean {
	if (hasRole(session, ROLE_ADMIN)) return true;
	if (cluster && hasRole(session, clusterRoleAdmin(cluster))) return true;
	return false;
}

// Server-side gate. Unauthenticated users land on `/` to sign in;
// authenticated-but-unauthorised users get a hard 403 instead of a
// silent redirect — the latter looks like a broken link, the former
// makes the missing role obvious. Per-cluster `cluster` arg is
// optional; when present, cluster-scoped roles are also accepted.
export function requireRead(session: Session | null | undefined, cluster?: string): void {
	if (!session?.user) throw redirect(303, '/');
	if (!canRead(session, cluster)) {
		throw error(403, 'Missing platform_admin/platform_sre or cluster-scoped role');
	}
}

export function requireWrite(session: Session | null | undefined, cluster?: string): void {
	if (!session?.user) throw redirect(303, '/');
	if (!canWrite(session, cluster)) {
		throw error(403, 'platform_admin or cluster_<name>_admin role required for this action');
	}
}
