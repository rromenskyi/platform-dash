import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, metrics } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type NodeRow = {
	name: string;
	ready: boolean;
	conditions: Array<{ type: string; status: string; reason?: string }>;
	roles: string[];
	internalIP?: string;
	externalIP?: string;
	osImage?: string;
	kernel?: string;
	kubeletVersion?: string;
	containerRuntime?: string;
	architecture?: string;
	creationTimestamp?: string;
	allocatable: { cpu: string; memory: string; pods: string };
	capacity: { cpu: string; memory: string; pods: string };
	usage: {
		cpuRequestsMilli: number;
		memoryRequestsBytes: number;
		podsScheduled: number;
		// Live actual values from metrics-server. Undefined when the
		// cluster doesn't have metrics-server installed.
		actualCpuMilli?: number;
		actualMemoryBytes?: number;
	};
	taints: Array<{ key: string; value?: string; effect: string }>;
	labels: Record<string, string>;
	unschedulable: boolean;
};

// Quantity parsers — k8s expresses CPU as "100m" or "1" and memory as
// "256Mi" / "2Gi" etc. We only need the numeric value for summation;
// no unit conversion required for display since we sum like-for-like
// then re-render as the same units the node reports.
function parseCpu(v: string | undefined): number {
	if (!v) return 0;
	if (v.endsWith('m')) return parseInt(v, 10);
	const n = parseFloat(v);
	return Number.isFinite(n) ? n * 1000 : 0;
}

const MEM_UNITS: Record<string, number> = {
	Ki: 1024,
	Mi: 1024 ** 2,
	Gi: 1024 ** 3,
	Ti: 1024 ** 4,
	Pi: 1024 ** 5,
	K: 1000,
	M: 1000 ** 2,
	G: 1000 ** 3,
	T: 1000 ** 4,
	P: 1000 ** 5
};
function parseMem(v: string | undefined): number {
	if (!v) return 0;
	const m = /^([\d.]+)([a-zA-Z]*)$/.exec(v);
	if (!m) return 0;
	const num = parseFloat(m[1]);
	if (!Number.isFinite(num)) return 0;
	const mult = m[2] ? (MEM_UNITS[m[2]] ?? 1) : 1;
	return num * mult;
}

function rolesFromLabels(labels: Record<string, string>): string[] {
	const roles: string[] = [];
	for (const k of Object.keys(labels)) {
		if (k.startsWith('node-role.kubernetes.io/')) {
			const r = k.slice('node-role.kubernetes.io/'.length);
			if (r) roles.push(r);
		}
	}
	return roles.length ? roles : ['<none>'];
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) {
		throw redirect(303, '/');
	}

	const cluster = event.params.cluster;
	// ns filter from /k8s/[cluster]/+layout.server.ts — when set, the
	// "pods/requests on this node" stats are scoped to that namespace,
	// so the operator can answer "how much is my workload taking up
	// on each node" without summing across the whole cluster.
	const ns = event.url.searchParams.get('ns') || '';

	let rows: NodeRow[] = [];
	let error: string | null = null;
	let metricsAvailable = false;
	try {
		const [nodesRes, podsRes, nodeMetricsRes] = await Promise.all([
			time(`${cluster}/listNode`, () => core(cluster).listNode()),
			ns
				? time(`${cluster}/listNamespacedPod`, () =>
						core(cluster).listNamespacedPod({ namespace: ns })
					)
				: time(`${cluster}/listPodForAllNamespaces`, () =>
						core(cluster).listPodForAllNamespaces()
					),
			// Optional — metrics-server may not be installed.
			time(`${cluster}/getNodeMetrics`, () => metrics(cluster).getNodeMetrics()).catch(
				() => null
			)
		]);

		const usageByNode = new Map<string, { cpuMilli: number; memBytes: number }>();
		if (nodeMetricsRes && nodeMetricsRes.items) {
			metricsAvailable = true;
			for (const m of nodeMetricsRes.items) {
				usageByNode.set(m.metadata.name, {
					cpuMilli: parseCpu(m.usage.cpu),
					memBytes: parseMem(m.usage.memory)
				});
			}
		}

		// Index pods by node so each NodeRow can compute its own usage
		// in a single pass without re-walking the pod list.
		const podsByNode = new Map<string, typeof podsRes.items>();
		for (const p of podsRes.items) {
			const node = p.spec?.nodeName;
			if (!node) continue;
			const arr = podsByNode.get(node);
			if (arr) arr.push(p);
			else podsByNode.set(node, [p]);
		}

		rows = nodesRes.items.map((n) => {
			const labels = (n.metadata?.labels ?? {}) as Record<string, string>;
			const conditions = (n.status?.conditions ?? []).map((c) => ({
				type: c.type,
				status: c.status,
				reason: c.reason
			}));
			const ready = conditions.some((c) => c.type === 'Ready' && c.status === 'True');
			const addresses = (n.status?.addresses ?? []) as Array<{ type: string; address: string }>;
			const cap = (n.status?.capacity ?? {}) as Record<string, string>;
			const alloc = (n.status?.allocatable ?? {}) as Record<string, string>;
			const info = n.status?.nodeInfo;

			const onNode = podsByNode.get(n.metadata?.name ?? '') ?? [];
			let cpuMilli = 0;
			let memBytes = 0;
			for (const p of onNode) {
				if (p.status?.phase !== 'Running' && p.status?.phase !== 'Pending') continue;
				for (const c of p.spec?.containers ?? []) {
					const req = c.resources?.requests as Record<string, string> | undefined;
					cpuMilli += parseCpu(req?.cpu);
					memBytes += parseMem(req?.memory);
				}
			}

			return {
				name: n.metadata?.name ?? '?',
				ready,
				conditions,
				roles: rolesFromLabels(labels),
				internalIP: addresses.find((a) => a.type === 'InternalIP')?.address,
				externalIP: addresses.find((a) => a.type === 'ExternalIP')?.address,
				osImage: info?.osImage,
				kernel: info?.kernelVersion,
				kubeletVersion: info?.kubeletVersion,
				containerRuntime: info?.containerRuntimeVersion,
				architecture: info?.architecture,
				creationTimestamp: n.metadata?.creationTimestamp
					? new Date(n.metadata.creationTimestamp).toISOString()
					: undefined,
				allocatable: { cpu: alloc.cpu ?? '?', memory: alloc.memory ?? '?', pods: alloc.pods ?? '?' },
				capacity: { cpu: cap.cpu ?? '?', memory: cap.memory ?? '?', pods: cap.pods ?? '?' },
				usage: {
					cpuRequestsMilli: cpuMilli,
					memoryRequestsBytes: memBytes,
					podsScheduled: onNode.length,
					actualCpuMilli: usageByNode.get(n.metadata?.name ?? '')?.cpuMilli,
					actualMemoryBytes: usageByNode.get(n.metadata?.name ?? '')?.memBytes
				},
				taints: (n.spec?.taints ?? []).map((t) => ({
					key: t.key,
					value: t.value,
					effect: t.effect
				})),
				labels,
				unschedulable: !!n.spec?.unschedulable
			};
		});

		rows.sort((a, b) => a.name.localeCompare(b.name));
	} catch (err) {
		console.error('list nodes failed', err);
		error = err instanceof Error ? err.message : String(err);
	}

	return { session, rows, error, scopedNs: ns, cluster, metricsAvailable };
};
