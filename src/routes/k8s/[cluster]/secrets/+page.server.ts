import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';

export type SecretRow = {
	namespace: string;
	name: string;
	type: string;
	keys: string[];
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	const accessible = accessibleNamespaces(session, cluster);
	let rows: SecretRow[] = [];
	let error: string | null = null;
	try {
		const res = ns
			? await time(`${cluster}/listNamespacedSecret`, () =>
					core(cluster).listNamespacedSecret({ namespace: ns })
				)
			: await time(`${cluster}/listSecretForAllNamespaces`, () =>
					core(cluster).listSecretForAllNamespaces()
				);
		rows = res.items
			.filter((s) => {
				if (accessible === 'all') return true;
				const n = s.metadata?.namespace;
				return !!n && accessible.includes(n);
			})
			.map((s) => ({
				namespace: s.metadata?.namespace ?? '?',
				name: s.metadata?.name ?? '?',
				type: s.type ?? 'Opaque',
				keys: Object.keys((s.data ?? {}) as Record<string, string>),
				creationTimestamp: s.metadata?.creationTimestamp
					? new Date(s.metadata.creationTimestamp).toISOString()
					: undefined
			}))
			.sort((a, b) => {
				if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
				return a.name.localeCompare(b.name);
			});
	} catch (err) {
		console.error('list secrets failed', err);
		error = err instanceof Error ? err.message : String(err);
	}
	return { rows, error, cluster };
};
