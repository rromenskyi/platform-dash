import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { networking } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { auditScopedTo } from '$lib/audit.server';

export type IngressRule = {
	host?: string;
	path: string;
	pathType?: string;
	service: string;
	port: string;
};

export const load: PageServerLoad = async (event) => {
	const { cluster, ns, name } = event.params;

	let ing;
	try {
		ing = await time(`${cluster}/readNamespacedIngress`, () =>
			networking(cluster).readNamespacedIngress({ name, namespace: ns })
		);
	} catch (err) {
		console.error('read ingress failed', err);
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `Ingress ${ns}/${name} not found`);
	}

	const rules: IngressRule[] = [];
	const hostSet = new Set<string>();
	for (const r of ing.spec?.rules ?? []) {
		if (r.host) hostSet.add(r.host);
		for (const p of r.http?.paths ?? []) {
			const svc = p.backend?.service;
			const port = svc?.port?.number ?? svc?.port?.name ?? '';
			rules.push({
				host: r.host,
				path: p.path ?? '/',
				pathType: p.pathType,
				service: svc?.name ?? '?',
				port: String(port)
			});
		}
	}
	const tlsHosts: string[] = [];
	for (const t of ing.spec?.tls ?? []) tlsHosts.push(...(t.hosts ?? []));

	const lbIngress = ing.status?.loadBalancer?.ingress ?? [];

	return {
		cluster,
		ns,
		name,
		ing: {
			className: ing.spec?.ingressClassName,
			hosts: Array.from(hostSet).sort(),
			rules,
			tlsHosts: Array.from(new Set(tlsHosts)).sort(),
			defaultBackend:
				ing.spec?.defaultBackend?.service
					? {
							service: ing.spec.defaultBackend.service.name ?? '?',
							port: String(
								ing.spec.defaultBackend.service.port?.number ??
									ing.spec.defaultBackend.service.port?.name ??
									''
							)
						}
					: null,
			lbIngress: lbIngress.map((i) => ({ ip: i.ip, hostname: i.hostname })),
			creationTimestamp: ing.metadata?.creationTimestamp
				? new Date(ing.metadata.creationTimestamp).toISOString()
				: undefined,
			labels: (ing.metadata?.labels ?? {}) as Record<string, string>,
			annotations: (ing.metadata?.annotations ?? {}) as Record<string, string>
		},
		scopedAudit: auditScopedTo({ cluster, kind: 'Ingress', namespace: ns, name, limit: 20 })
	};
};
