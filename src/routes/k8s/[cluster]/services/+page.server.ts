import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { accessibleNamespaces } from '$lib/authz';

export type SvcRow = {
	namespace: string;
	name: string;
	type: string;
	clusterIP: string;
	externalIP: string;
	ports: string;
	selector: string;
	creationTimestamp?: string;
};

function fmtPorts(ports: Array<{ port?: number; targetPort?: number | string; protocol?: string; name?: string; nodePort?: number }> | undefined): string {
	if (!ports || ports.length === 0) return '—';
	return ports
		.map((p) => {
			const proto = p.protocol && p.protocol !== 'TCP' ? `/${p.protocol}` : '';
			const target = p.targetPort != null && p.targetPort !== p.port ? `→${p.targetPort}` : '';
			const node = p.nodePort ? `:${p.nodePort}(node)` : '';
			return `${p.port ?? '?'}${proto}${target}${node}`;
		})
		.join(', ');
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const cluster = event.params.cluster;
	const ns = event.url.searchParams.get('ns') || '';
	const accessible = accessibleNamespaces(session, cluster);
	let rows: SvcRow[] = [];
	let error: string | null = null;
	try {
		const res = ns
			? await time(`${cluster}/listNamespacedService`, () =>
					core(cluster).listNamespacedService({ namespace: ns })
				)
			: await time(`${cluster}/listServiceForAllNamespaces`, () =>
					core(cluster).listServiceForAllNamespaces()
				);
		rows = res.items
			.filter((s) => {
				if (accessible === 'all') return true;
				const n = s.metadata?.namespace;
				return !!n && accessible.includes(n);
			})
			.map((s) => {
				const ext: string[] = [];
				if (s.spec?.externalIPs) ext.push(...s.spec.externalIPs);
				const ing = (s.status?.loadBalancer?.ingress ?? []) as Array<{ ip?: string; hostname?: string }>;
				for (const i of ing) {
					if (i.ip) ext.push(i.ip);
					if (i.hostname) ext.push(i.hostname);
				}
				return {
					namespace: s.metadata?.namespace ?? '?',
					name: s.metadata?.name ?? '?',
					type: s.spec?.type ?? 'ClusterIP',
					clusterIP: s.spec?.clusterIP ?? '—',
					externalIP: ext.join(', ') || '—',
					ports: fmtPorts(s.spec?.ports),
					selector: Object.entries((s.spec?.selector ?? {}) as Record<string, string>)
						.map(([k, v]) => `${k}=${v}`)
						.join(','),
					creationTimestamp: s.metadata?.creationTimestamp
						? new Date(s.metadata.creationTimestamp).toISOString()
						: undefined
				};
			})
			.sort((a, b) => {
				if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
				return a.name.localeCompare(b.name);
			});
	} catch (err) {
		console.error('list services failed', err);
		error = err instanceof Error ? err.message : String(err);
	}
	return { rows, error, cluster };
};
