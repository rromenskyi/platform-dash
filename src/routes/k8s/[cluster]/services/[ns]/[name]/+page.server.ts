import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { auditScopedTo } from '$lib/audit.server';

export type SvcPort = {
	name?: string;
	port: number;
	targetPort?: number | string;
	protocol: string;
	nodePort?: number;
};

export type EndpointAddr = {
	ip: string;
	nodeName?: string;
	targetRef?: { kind?: string; name?: string; namespace?: string };
	ready: boolean;
};

export type ScopedEvent = {
	type: string;
	reason: string;
	message: string;
	count: number;
	lastSeen?: string;
};

async function listScopedEvents(
	cluster: string,
	ns: string,
	name: string,
	kind: string
): Promise<ScopedEvent[]> {
	try {
		const res = await time(`${cluster}/listNamespacedEvent`, () =>
			core(cluster).listNamespacedEvent({
				namespace: ns,
				fieldSelector: `involvedObject.name=${name},involvedObject.kind=${kind}`
			})
		);
		return res.items
			.map((e) => ({
				type: e.type ?? '?',
				reason: e.reason ?? '?',
				message: e.message ?? '',
				count: e.count ?? 1,
				lastSeen: e.lastTimestamp
					? new Date(e.lastTimestamp).toISOString()
					: e.eventTime
						? new Date(e.eventTime).toISOString()
						: undefined
			}))
			.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
	} catch (err) {
		console.warn(`list events ${cluster}/${ns}/${kind}/${name} failed`, err);
		return [];
	}
}

export const load: PageServerLoad = async (event) => {
	const { cluster, ns, name } = event.params;

	let svc;
	try {
		svc = await time(`${cluster}/readNamespacedService`, () =>
			core(cluster).readNamespacedService({ name, namespace: ns })
		);
	} catch (err) {
		console.error('read service failed', err);
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `Service ${ns}/${name} not found`);
	}

	const ports: SvcPort[] = (svc.spec?.ports ?? []).map((p) => ({
		name: p.name,
		port: p.port ?? 0,
		targetPort: p.targetPort as number | string | undefined,
		protocol: p.protocol ?? 'TCP',
		nodePort: p.nodePort
	}));

	// Endpoints address list — best-effort. Older clusters expose
	// `Endpoints`; newer clusters expose `EndpointSlices`. We hit the
	// classic Endpoints object since it aggregates by service name and
	// is enough for "is this service backed by anything".
	const endpoints: EndpointAddr[] = [];
	let endpointsError: string | null = null;
	try {
		const ep = await time(`${cluster}/readNamespacedEndpoints`, () =>
			core(cluster).readNamespacedEndpoints({ name, namespace: ns })
		);
		for (const subset of ep.subsets ?? []) {
			for (const a of subset.addresses ?? []) {
				endpoints.push({
					ip: a.ip ?? '?',
					nodeName: a.nodeName,
					targetRef: a.targetRef
						? {
								kind: a.targetRef.kind,
								name: a.targetRef.name,
								namespace: a.targetRef.namespace
							}
						: undefined,
					ready: true
				});
			}
			for (const a of subset.notReadyAddresses ?? []) {
				endpoints.push({
					ip: a.ip ?? '?',
					nodeName: a.nodeName,
					targetRef: a.targetRef
						? {
								kind: a.targetRef.kind,
								name: a.targetRef.name,
								namespace: a.targetRef.namespace
							}
						: undefined,
					ready: false
				});
			}
		}
	} catch (err) {
		const code =
			typeof err === 'object' && err !== null && 'code' in err
				? (err as { code: number }).code
				: 0;
		// 404 just means no Endpoints object yet — empty list is right.
		if (code !== 404) {
			endpointsError = err instanceof Error ? err.message : String(err);
		}
	}

	return {
		cluster,
		ns,
		name,
		svc: {
			type: svc.spec?.type ?? 'ClusterIP',
			clusterIP: svc.spec?.clusterIP ?? '—',
			clusterIPs: svc.spec?.clusterIPs ?? [],
			externalIPs: svc.spec?.externalIPs ?? [],
			loadBalancerIP: svc.status?.loadBalancer?.ingress?.[0]?.ip ?? svc.status?.loadBalancer?.ingress?.[0]?.hostname,
			selector: (svc.spec?.selector ?? {}) as Record<string, string>,
			sessionAffinity: svc.spec?.sessionAffinity,
			externalTrafficPolicy: svc.spec?.externalTrafficPolicy,
			creationTimestamp: svc.metadata?.creationTimestamp
				? new Date(svc.metadata.creationTimestamp).toISOString()
				: undefined,
			labels: (svc.metadata?.labels ?? {}) as Record<string, string>,
			annotations: (svc.metadata?.annotations ?? {}) as Record<string, string>
		},
		ports,
		endpoints,
		endpointsError,
		events: await listScopedEvents(cluster, ns, name, 'Service'),
		scopedAudit: auditScopedTo({ cluster, kind: 'Service', namespace: ns, name, limit: 20 })
	};
};
