import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core, metrics } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export type ContainerUsage = {
	cpu?: string;
	memory?: string;
};

export type PodEvent = {
	type: string;
	reason: string;
	message: string;
	count: number;
	firstSeen?: string;
	lastSeen?: string;
};

export type ContainerView = {
	name: string;
	image: string;
	ready: boolean;
	started: boolean;
	state: string;
	restartCount: number;
	lastTerminationReason?: string;
	lastTerminationExitCode?: number;
	requests?: Record<string, string>;
	limits?: Record<string, string>;
	envCount: number;
	mounts: Array<{ name: string; path: string; readOnly: boolean }>;
	usage?: ContainerUsage;
};

export const load: PageServerLoad = async (event) => {
	const ns = event.params.ns;
	const name = event.params.name;
	const cluster = event.params.cluster;

	let pod;
	try {
		pod = await time(`${cluster}/readNamespacedPod`, () =>
			core(cluster).readNamespacedPod({ name, namespace: ns })
		);
	} catch (err) {
		console.error('read pod failed', err);
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `Pod "${ns}/${name}" not found`);
	}

	// Container view — merge spec (image, env, resources, mounts) with
	// status (state, restarts, lastTermination) so the page renders one
	// row per container without the template having to cross-reference.
	const statusByName = new Map(
		(pod.status?.containerStatuses ?? []).map((s) => [s.name, s])
	);

	// Best-effort metrics-server lookup for actual CPU / memory usage
	// per container. metrics.k8s.io is optional — clusters without
	// metrics-server installed return 404; the fallback is just no
	// usage column on the rows. We only fetch this pod's namespace
	// (cheap) rather than cluster-wide.
	const usageByContainer = new Map<string, ContainerUsage>();
	let metricsAvailable = true;
	try {
		const ml = await time(`${cluster}/getPodMetrics`, () =>
			metrics(cluster).getPodMetrics(ns)
		);
		const item = ml.items.find((i) => i.metadata.name === name);
		if (item) {
			for (const c of item.containers) {
				usageByContainer.set(c.name, { cpu: c.usage.cpu, memory: c.usage.memory });
			}
		}
	} catch {
		// metrics-server not installed or RBAC not granted — silent.
		metricsAvailable = false;
	}

	const containers: ContainerView[] = (pod.spec?.containers ?? []).map((c) => {
		const s = statusByName.get(c.name);
		const stateKey = s?.state?.running
			? 'running'
			: s?.state?.waiting
				? `waiting${s.state.waiting.reason ? ` (${s.state.waiting.reason})` : ''}`
				: s?.state?.terminated
					? `terminated${s.state.terminated.reason ? ` (${s.state.terminated.reason})` : ''}`
					: '?';
		return {
			name: c.name,
			image: c.image ?? '?',
			ready: !!s?.ready,
			started: !!s?.started,
			state: stateKey,
			restartCount: s?.restartCount ?? 0,
			lastTerminationReason: s?.lastState?.terminated?.reason,
			lastTerminationExitCode: s?.lastState?.terminated?.exitCode,
			requests: c.resources?.requests as Record<string, string> | undefined,
			limits: c.resources?.limits as Record<string, string> | undefined,
			envCount: c.env?.length ?? 0,
			mounts: (c.volumeMounts ?? []).map((m) => ({
				name: m.name,
				path: m.mountPath,
				readOnly: !!m.readOnly
			})),
			usage: usageByContainer.get(c.name)
		};
	});

	const volumes = (pod.spec?.volumes ?? []).map((v) => {
		// Pick the first non-name key as the source kind — k8s Volume
		// is a tagged union but the SDK types it as flat optional fields.
		const flat = v as unknown as Record<string, unknown>;
		const sourceKind = Object.keys(flat).find((k) => k !== 'name') ?? 'unknown';
		return { name: v.name, sourceKind };
	});

	const conditions = (pod.status?.conditions ?? []).map((c) => ({
		type: c.type,
		status: c.status,
		reason: c.reason,
		lastTransitionTime: c.lastTransitionTime
			? new Date(c.lastTransitionTime).toISOString()
			: undefined
	}));

	const ownerRefs = (pod.metadata?.ownerReferences ?? []).map((o) => ({
		kind: o.kind,
		name: o.name
	}));

	// Events: filter by involvedObject. Fetched separately so a missing
	// RBAC rule on events doesn't blank the whole page.
	let events: PodEvent[] = [];
	let eventsError: string | null = null;
	try {
		const evRes = await time(`${cluster}/listNamespacedEvent`, () =>
			core(cluster).listNamespacedEvent({
				namespace: ns,
				fieldSelector: `involvedObject.name=${name},involvedObject.kind=Pod`
			})
		);
		events = evRes.items
			.map((e) => ({
				type: e.type ?? '?',
				reason: e.reason ?? '?',
				message: e.message ?? '',
				count: e.count ?? 1,
				firstSeen: e.firstTimestamp
					? new Date(e.firstTimestamp).toISOString()
					: e.eventTime
						? new Date(e.eventTime).toISOString()
						: undefined,
				lastSeen: e.lastTimestamp
					? new Date(e.lastTimestamp).toISOString()
					: e.eventTime
						? new Date(e.eventTime).toISOString()
						: undefined
			}))
			.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
	} catch (err) {
		console.error('list events failed', err);
		eventsError = err instanceof Error ? err.message : String(err);
	}

	return {
		cluster,
		pod: {
			name,
			namespace: ns,
			node: pod.spec?.nodeName,
			phase: pod.status?.phase ?? '?',
			podIP: pod.status?.podIP,
			hostIP: pod.status?.hostIP,
			qosClass: pod.status?.qosClass,
			startTime: pod.status?.startTime
				? new Date(pod.status.startTime).toISOString()
				: undefined,
			creationTimestamp: pod.metadata?.creationTimestamp
				? new Date(pod.metadata.creationTimestamp).toISOString()
				: undefined,
			labels: (pod.metadata?.labels ?? {}) as Record<string, string>,
			annotations: (pod.metadata?.annotations ?? {}) as Record<string, string>,
			ownerRefs
		},
		containers,
		volumes,
		conditions,
		events,
		eventsError,
		metricsAvailable
	};
};
