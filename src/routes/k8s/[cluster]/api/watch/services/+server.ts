import type { RequestHandler } from './$types';
import { buildWatchResponse } from '$lib/sse-watch.server';

type Port = { port?: number; targetPort?: number | string; protocol?: string; nodePort?: number };
type Ing = { ip?: string; hostname?: string };
type ItemMin = {
	metadata?: { namespace?: string; name?: string; creationTimestamp?: string | Date };
	spec?: { type?: string; clusterIP?: string; externalIPs?: string[]; ports?: Port[]; selector?: Record<string, string> };
	status?: { loadBalancer?: { ingress?: Ing[] } };
};

function fmtPorts(ports: Port[] | undefined): string {
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

export const GET: RequestHandler = async (event) =>
	buildWatchResponse(
		(_cluster) => ({
			cluster: _cluster,
			pathFor: (n) => (n ? `/api/v1/namespaces/${n}/services` : `/api/v1/services`),
			mapItem: (raw) => {
				const s = raw as ItemMin;
				const ext: string[] = [];
				if (s.spec?.externalIPs) ext.push(...s.spec.externalIPs);
				for (const i of s.status?.loadBalancer?.ingress ?? []) {
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
			}
		}),
		event
	);
