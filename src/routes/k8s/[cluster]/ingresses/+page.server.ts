import type { PageServerLoad } from './$types';
import { networking } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';

export type IngressRow = {
	namespace: string;
	name: string;
	className?: string;
	hosts: string[];
	rules: Array<{ host?: string; path: string; service: string; port: string }>;
	tlsHosts: string[];
	creationTimestamp?: string;
};

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	const accessible = accessibleNamespaces(session, cluster);
	let rows: IngressRow[] = [];
	let error: string | null = null;
	try {
		const res = ns
			? await time(`${cluster}/listNamespacedIngress`, () =>
					networking(cluster).listNamespacedIngress({ namespace: ns })
				)
			: await time(`${cluster}/listIngressForAllNamespaces`, () =>
					networking(cluster).listIngressForAllNamespaces()
				);
		rows = res.items
			.filter((i) => {
				if (accessible === 'all') return true;
				const n = i.metadata?.namespace;
				return !!n && accessible.includes(n);
			})
			.map((i) => {
				const rules: IngressRow['rules'] = [];
				const hostsSet = new Set<string>();
				for (const r of i.spec?.rules ?? []) {
					if (r.host) hostsSet.add(r.host);
					for (const p of r.http?.paths ?? []) {
						const svc = p.backend?.service;
						const port = svc?.port?.number ?? svc?.port?.name ?? '';
						rules.push({
							host: r.host,
							path: p.path ?? '/',
							service: svc?.name ?? '?',
							port: String(port)
						});
					}
				}
				const tlsHosts: string[] = [];
				for (const t of i.spec?.tls ?? []) tlsHosts.push(...(t.hosts ?? []));
				return {
					namespace: i.metadata?.namespace ?? '?',
					name: i.metadata?.name ?? '?',
					className: i.spec?.ingressClassName,
					hosts: Array.from(hostsSet).sort(),
					rules,
					tlsHosts: Array.from(new Set(tlsHosts)).sort(),
					creationTimestamp: i.metadata?.creationTimestamp
						? new Date(i.metadata.creationTimestamp).toISOString()
						: undefined
				};
			})
			.sort((a, b) => {
				if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
				return a.name.localeCompare(b.name);
			});
	} catch (err) {
		console.error('list ingresses failed', err);
		error = err instanceof Error ? err.message : String(err);
	}
	return { rows, error, cluster };
};
