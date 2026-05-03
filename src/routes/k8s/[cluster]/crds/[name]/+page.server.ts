import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiextensions, customObjects } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { canRead, accessibleNamespaces } from '$lib/authz';

export type CrdVersionInfo = {
	name: string;
	served: boolean;
	storage: boolean;
	hasSchema: boolean;
};

export type CrdInstance = {
	namespace?: string;
	name: string;
	creationTimestamp?: string;
};

function pickServingVersion(versions: CrdVersionInfo[]): string | null {
	const stored = versions.find((v) => v.storage && v.served);
	if (stored) return stored.name;
	const served = versions.find((v) => v.served);
	return served ? served.name : versions[0]?.name ?? null;
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

	const { name, cluster } = event.params;

	let group = '';
	let plural = '';
	let scope = '';
	let kind = '';
	let shortNames: string[] = [];
	let versions: CrdVersionInfo[] = [];
	let creationTimestamp: string | undefined;
	// openAPIV3Schema for the storage version, surfaced raw to the
	// page so the schema viewer can render a tree without re-fetching.
	let storageSchema: unknown = null;

	try {
		const crd = await time(`${cluster}/readCustomResourceDefinition`, () =>
			apiextensions(cluster).readCustomResourceDefinition({ name })
		);
		group = crd.spec.group;
		plural = crd.spec.names.plural;
		scope = crd.spec.scope;
		kind = crd.spec.names.kind;
		shortNames = crd.spec.names.shortNames ?? [];
		versions = (crd.spec.versions ?? []).map((v) => ({
			name: v.name,
			served: v.served,
			storage: v.storage,
			hasSchema: !!v.schema?.openAPIV3Schema
		}));
		const storage = crd.spec.versions?.find((v) => v.storage) ?? crd.spec.versions?.[0];
		// k8s client returns class instances (V1JSONSchemaProps); devalue
		// can only serialize POJOs, so round-trip through JSON to flatten.
		const rawSchema = storage?.schema?.openAPIV3Schema;
		storageSchema = rawSchema ? JSON.parse(JSON.stringify(rawSchema)) : null;
		creationTimestamp = crd.metadata?.creationTimestamp
			? new Date(crd.metadata.creationTimestamp).toISOString()
			: undefined;
	} catch (err) {
		console.error('read crd failed', err);
		const status =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(status, `CRD "${name}" not found or unreadable`);
	}

	let instances: CrdInstance[] = [];
	let instancesError: string | null = null;

	// Global ns filter from /k8s/[cluster]/+layout.server.ts via the URL
	// — only meaningful for Namespaced CRDs; cluster-scoped objects
	// ignore it.
	const nsFilter = event.url.searchParams.get('ns') || '';
	const accessible = accessibleNamespaces(session, cluster);
	// Cluster-scoped CRD instance list is hidden from ns-only operators
	// — they can see the definition (it's metadata) but not who else
	// owns instances of it.
	const hideClusterScopedInstances = scope !== 'Namespaced' && accessible !== 'all';

	const servingVersion = pickServingVersion(versions);
	if (servingVersion && !hideClusterScopedInstances) {
		try {
			type ListRes = { items?: Array<Record<string, unknown>> };
			let items: Array<Record<string, unknown>> = [];
			if (scope === 'Namespaced') {
				if (nsFilter) {
					// Operator picked a single ns — verify they can read it.
					if (!canRead(session, cluster, nsFilter)) {
						throw error(403, `no read role for namespace "${nsFilter}"`);
					}
					const res = (await time(`${cluster}/listNamespacedCustomObject`, () =>
						customObjects(cluster).listNamespacedCustomObject({
							group,
							version: servingVersion,
							namespace: nsFilter,
							plural
						})
					)) as ListRes;
					items = res.items ?? [];
				} else if (accessible === 'all') {
					const res = (await time(`${cluster}/listCustomObjectForAllNamespaces`, () =>
						customObjects(cluster).listCustomObjectForAllNamespaces({
							group,
							version: servingVersion,
							plural
						})
					)) as ListRes;
					items = res.items ?? [];
				} else {
					// ns-only — fan out across the namespaces they can read.
					const lists = await Promise.all(
						accessible.map(async (n): Promise<Array<Record<string, unknown>>> => {
							try {
								const r = (await time(`${cluster}/listNamespacedCustomObject(${n})`, () =>
									customObjects(cluster).listNamespacedCustomObject({
										group,
										version: servingVersion,
										namespace: n,
										plural
									})
								)) as ListRes;
								return r.items ?? [];
							} catch {
								return [];
							}
						})
					);
					items = lists.flat();
				}
			} else {
				const res = (await time(`${cluster}/listClusterCustomObject`, () =>
					customObjects(cluster).listClusterCustomObject({
						group,
						version: servingVersion,
						plural
					})
				)) as ListRes;
				items = res.items ?? [];
			}
			instances = items.map((it) => {
				const meta = (it.metadata ?? {}) as {
					name?: string;
					namespace?: string;
					creationTimestamp?: string;
				};
				return {
					namespace: meta.namespace,
					name: meta.name ?? '?',
					creationTimestamp: meta.creationTimestamp
						? new Date(meta.creationTimestamp).toISOString()
						: undefined
				};
			});
			instances.sort((a, b) => {
				if ((a.namespace ?? '') !== (b.namespace ?? '')) {
					return (a.namespace ?? '').localeCompare(b.namespace ?? '');
				}
				return a.name.localeCompare(b.name);
			});
		} catch (err) {
			console.error('list custom objects failed', err);
			instancesError = err instanceof Error ? err.message : String(err);
		}
	}

	return {
		session,
		cluster,
		crd: {
			name,
			group,
			plural,
			scope,
			kind,
			shortNames,
			versions,
			creationTimestamp,
			servingVersion,
			storageSchema
		},
		instances,
		instancesError,
		hideClusterScopedInstances
	};
};
