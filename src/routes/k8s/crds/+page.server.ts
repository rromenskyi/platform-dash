import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiextensions } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type CrdRow = {
	name: string;
	group: string;
	version: string;
	scope: string;
	kind: string;
	plural: string;
	shortNames: string[];
	creationTimestamp?: string;
};

// "Stored" version is the canonical write target; we surface it to
// match what `kubectl get` resolves to. Older served versions stay
// in the detail view.
function pickStoredVersion(versions: Array<{ name: string; storage?: boolean; served?: boolean }> | undefined): string {
	if (!versions || versions.length === 0) return '?';
	const stored = versions.find((v) => v.storage);
	if (stored) return stored.name;
	const served = versions.find((v) => v.served);
	return (served ?? versions[0]).name;
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

	let rows: CrdRow[] = [];
	let error: string | null = null;

	try {
		const res = await time('listCustomResourceDefinition', () =>
			apiextensions().listCustomResourceDefinition()
		);
		rows = res.items.map((c) => ({
			name: c.metadata?.name ?? '?',
			group: c.spec.group,
			version: pickStoredVersion(c.spec.versions),
			scope: c.spec.scope,
			kind: c.spec.names.kind,
			plural: c.spec.names.plural,
			shortNames: c.spec.names.shortNames ?? [],
			creationTimestamp: c.metadata?.creationTimestamp
				? new Date(c.metadata.creationTimestamp).toISOString()
				: undefined
		}));
		rows.sort((a, b) => {
			if (a.group !== b.group) return a.group.localeCompare(b.group);
			return a.kind.localeCompare(b.kind);
		});
	} catch (err) {
		console.error('list crds failed', err);
		error = err instanceof Error ? err.message : String(err);
	}

	return { session, rows, error };
};
