import { error, redirect } from '@sveltejs/kit';
import type { Session } from '@auth/core/types';

// Project-role keys as defined in the Zitadel Application
// (~/platform/modules/zitadel-app, role_keys: platform_admin /
// platform_sre / user). Anyone outside admin+sre is bounced from the
// dashboard surfaces.
export const ROLE_ADMIN = 'platform_admin';
export const ROLE_SRE = 'platform_sre';

export function hasRole(session: Session | null | undefined, role: string): boolean {
	return !!session?.roles?.includes(role);
}

export function canRead(session: Session | null | undefined): boolean {
	return hasRole(session, ROLE_ADMIN) || hasRole(session, ROLE_SRE);
}

export function canWrite(session: Session | null | undefined): boolean {
	return hasRole(session, ROLE_ADMIN);
}

// Server-side gate. Unauthenticated users land on `/` to sign in;
// authenticated-but-unauthorised users get a hard 403 instead of a
// silent redirect — the latter looks like a broken link, the former
// makes the missing role obvious.
export function requireRead(session: Session | null | undefined): void {
	if (!session?.user) throw redirect(303, '/');
	if (!canRead(session)) {
		throw error(403, 'Missing platform_admin or platform_sre role');
	}
}

export function requireWrite(session: Session | null | undefined): void {
	if (!session?.user) throw redirect(303, '/');
	if (!canWrite(session)) {
		throw error(403, 'platform_admin role required for this action');
	}
}
