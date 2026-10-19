import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, metrics } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { withDeadline } from '$lib';
import { requireRead, accessibleNamespaces } from '$lib/authz';
import { parseCpuMilli, parseMemBytes } from '$lib/quantity';

export type NodePod = {
	namespace: string;
	name: string;
	phase: string;
	ready: string;
	restarts: number;
	startedAt?: string;
	// Image-pull / OOM surfacing — same heuristics as workloads list.
	imagePullError?: boolean;
	lastTermReason?: string;
};

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
		// Kubelet Summary API filesystem stats. nodefs is the kubelet
		// root fs (what DiskPressure evicts on); imagefs is only set
		// when container images live on a separate filesystem.
		// Undefined when the kubelet didn't answer in time.
		disk?: { usedBytes: number; capacityBytes: number };
		imageDisk?: { usedBytes: number; capacityBytes: number };
	};
	taints: Array<{ key: string; value?: string; effect: string }>;
	labels: Record<string, string>;
	unschedulable: boolean;
	// Pods scheduled on this node, filtered to namespaces the operator
	// can read. Sorted by namespace, then name. podsScheduled in usage
	// is the unfiltered count for capacity-pressure reasoning.
	pods: NodePod[];
};


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

type FsStats = { usedBytes?: number; capacityBytes?: number };
type DiskStats = Pick<NodeRow['usage'], 'disk' | 'imageDisk'>;

function fs(f: FsStats | undefined): { usedBytes: number; capacityBytes: number } | undefined {
	return f?.usedBytes != null && f.capacityBytes
		? { usedBytes: f.usedBytes, capacityBytes: f.capacityBytes }
		: undefined;
}

// Disk usage isn't in metrics-server, so ask each kubelet's Summary API
// through the apiserver node proxy. One call per node, in parallel and
// bounded: a slow or unreachable kubelet just drops its disk bar
// instead of holding the whole page.
async function fetchDiskStats(
	cluster: string,
	nodes: string[]
): Promise<Map<string, DiskStats>> {
	const out = new Map<string, DiskStats>();
	await Promise.all(
		nodes.map(async (name) => {
			try {
				const raw: unknown = await withDeadline(
					time(`${cluster}/nodeStatsSummary`, () =>
						core(cluster).connectGetNodeProxyWithPath({ name, path: 'stats/summary' })
					),
					4_000,
					`${cluster}/${name} stats/summary`
				);
				const j = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
					node?: { fs?: FsStats; runtime?: { imageFs?: FsStats } };
				};
				const disk = fs(j.node?.fs);
				const image = fs(j.node?.runtime?.imageFs);
				// Same capacity ⇒ same filesystem; don't draw it twice.
				const separate = image && disk && image.capacityBytes !== disk.capacityBytes;
				out.set(name, { disk, imageDisk: separate ? image : undefined });
			} catch {
				/* no disk bar for this node */
			}
		})
	);
	return out;
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
	// Nodes are cluster-scoped: names, IPs, labels, taints and summed
	// requests across every tenant. Cluster-wide readers only — ns-only
	// operators are denied, as authz.ts specifies.
	requireRead(session, cluster);
	const accessible = accessibleNamespaces(session, cluster);

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

		const diskByNode = await fetchDiskStats(
			cluster,
			nodesRes.items.map((n) => n.metadata?.name ?? '').filter(Boolean)
		);

		const usageByNode = new Map<string, { cpuMilli: number; memBytes: number }>();
		if (nodeMetricsRes && nodeMetricsRes.items) {
			metricsAvailable = true;
			for (const m of nodeMetricsRes.items) {
				usageByNode.set(m.metadata.name, {
					cpuMilli: parseCpuMilli(m.usage.cpu),
					memBytes: parseMemBytes(m.usage.memory)
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
					cpuMilli += parseCpuMilli(req?.cpu);
					memBytes += parseMemBytes(req?.memory);
				}
			}

			// Per-node pod list, filtered to namespaces the operator can
			// read. The unfiltered count stays in usage.podsScheduled so
			// "capacity pressure" stats still reflect reality even when
			// the operator only sees a subset of pods.
			const visibleOnNode = onNode.filter((p) => {
				const podNs = p.metadata?.namespace;
				if (!podNs) return false;
				if (accessible !== 'all' && !accessible.includes(podNs)) return false;
				return true;
			});
			const pods: NodePod[] = visibleOnNode
				.map((p): NodePod => {
					const containers = p.status?.containerStatuses ?? [];
					const readyCount = containers.filter((c) => c.ready).length;
					const total = containers.length || (p.spec?.containers?.length ?? 0);
					const restarts = containers.reduce((acc, c) => acc + (c.restartCount ?? 0), 0);
					const imagePullError = containers.some((c) => {
						const r = c.state?.waiting?.reason ?? '';
						return r === 'ImagePullBackOff' || r === 'ErrImagePull';
					});
					let lastTermReason: string | undefined;
					for (const c of containers) {
						if (c.lastState?.terminated?.reason === 'OOMKilled') {
							lastTermReason = 'OOMKilled';
							break;
						}
						if (!lastTermReason && c.lastState?.terminated?.reason) {
							lastTermReason = c.lastState.terminated.reason;
						}
					}
					return {
						namespace: p.metadata?.namespace ?? '?',
						name: p.metadata?.name ?? '?',
						phase: p.status?.phase ?? '?',
						ready: `${readyCount}/${total}`,
						restarts,
						startedAt: p.status?.startTime
							? new Date(p.status.startTime).toISOString()
							: undefined,
						imagePullError: imagePullError || undefined,
						lastTermReason
					};
				})
				.sort((a, b) => {
					if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
					return a.name.localeCompare(b.name);
				});

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
					actualMemoryBytes: usageByNode.get(n.metadata?.name ?? '')?.memBytes,
					...diskByNode.get(n.metadata?.name ?? '')
				},
				taints: (n.spec?.taints ?? []).map((t) => ({
					key: t.key,
					value: t.value,
					effect: t.effect
				})),
				labels,
				unschedulable: !!n.spec?.unschedulable,
				pods
			};
		});

		rows.sort((a, b) => a.name.localeCompare(b.name));
	} catch (err) {
		console.error('list nodes failed', err);
		error = err instanceof Error ? err.message : String(err);
	}

	return { session, rows, error, scopedNs: ns, cluster, metricsAvailable };
};
