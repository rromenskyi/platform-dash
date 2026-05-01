import type { RequestHandler } from './$types';
import { buildWatchResponse } from '$lib/sse-watch.server';

type Path = {
	path?: string;
	backend?: { service?: { name?: string; port?: { number?: number; name?: string } } };
};
type Rule = { host?: string; http?: { paths?: Path[] } };
type ItemMin = {
	metadata?: { namespace?: string; name?: string; creationTimestamp?: string | Date };
	spec?: {
		ingressClassName?: string;
		rules?: Rule[];
		tls?: Array<{ hosts?: string[] }>;
	};
};

export const GET: RequestHandler = async (event) =>
	buildWatchResponse(
		(_cluster) => ({
			cluster: _cluster,
			pathFor: (n) =>
				n
					? `/apis/networking.k8s.io/v1/namespaces/${n}/ingresses`
					: `/apis/networking.k8s.io/v1/ingresses`,
			mapItem: (raw) => {
				const i = raw as ItemMin;
				const rules: Array<{ host?: string; path: string; service: string; port: string }> = [];
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
			}
		}),
		event
	);
