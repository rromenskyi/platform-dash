import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiextensions, customObjects } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

function pickServingVersion(
	versions:
		| Array<{ name: string; storage?: boolean; served?: boolean }>
		| undefined
): string | null {
	if (!versions || versions.length === 0) return null;
	const stored = versions.find((v) => v.storage && v.served);
	if (stored) return stored.name;
	const served = versions.find((v) => v.served);
	return served ? served.name : versions[0].name;
}

// Strip the noisy server-side fields we never want to show in the
// viewer. resourceVersion is KEPT — the editor round-trips it as
// the optimistic-concurrency token; the apiserver rejects PUTs
// without it ("must be specified for an update", 422).
function clean(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...obj };
	const meta = out.metadata as Record<string, unknown> | undefined;
	if (meta) {
		const m = { ...meta };
		delete m.managedFields;
		delete m.generation;
		delete m.selfLink;
		out.metadata = m;
	}
	return out;
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

	const { name, cluster } = event.params;
	const ns = event.url.searchParams.get('ns') ?? '';
	const n = event.url.searchParams.get('n');

	if (!n) throw error(400, 'missing instance name (?n=)');

	let group = '';
	let plural = '';
	let scope = '';
	let kind = '';
	let servingVersion: string | null = null;

	try {
		const crd = await time(`${cluster}/readCustomResourceDefinition`, () =>
			apiextensions(cluster).readCustomResourceDefinition({ name })
		);
		group = crd.spec.group;
		plural = crd.spec.names.plural;
		scope = crd.spec.scope;
		kind = crd.spec.names.kind;
		servingVersion = pickServingVersion(crd.spec.versions);
	} catch (err) {
		console.error('read crd failed', err);
		throw error(404, `CRD "${name}" not found`);
	}

	if (!servingVersion) {
		throw error(409, `CRD "${name}" has no served version`);
	}

	let object: unknown = null;
	let fetchError: string | null = null;
	try {
		const res =
			scope === 'Namespaced'
				? await time(`${cluster}/getNamespacedCustomObject`, () =>
						customObjects(cluster).getNamespacedCustomObject({
							group,
							version: servingVersion,
							namespace: ns,
							plural,
							name: n
						})
					)
				: await time(`${cluster}/getClusterCustomObject`, () =>
						customObjects(cluster).getClusterCustomObject({
							group,
							version: servingVersion,
							plural,
							name: n
						})
					);
		object = clean(res as Record<string, unknown>);
	} catch (err) {
		console.error('get custom object failed', err);
		fetchError = err instanceof Error ? err.message : String(err);
	}

	return {
		session,
		cluster,
		crd: { name, group, plural, scope, kind, servingVersion },
		instance: { namespace: ns || null, name: n },
		object,
		fetchError
	};
};
