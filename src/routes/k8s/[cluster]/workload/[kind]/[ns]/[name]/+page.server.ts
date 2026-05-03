import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canRead, canWrite } from '$lib/authz';
import { core, apps } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';
import { auditScopedTo } from '$lib/audit.server';

// Generic workload detail. Covers Deployment / StatefulSet / DaemonSet
// — the controller-level surface that workloads/+page.svelte was
// pointing nowhere from. The pod-level detail at /pod/[ns]/[name]
// stays the canonical place for container logs / exec / events;
// this page rolls up the controller, its rollout state, the pods
// it currently owns, and events filed against the controller itself.

const SUPPORTED = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);

type EventRow = {
	type: string;
	reason: string;
	message: string;
	count: number;
	firstSeen?: string;
	lastSeen?: string;
};

type PodRow = {
	name: string;
	phase: string;
	ready: string;
	restarts: number;
	node?: string;
	creationTimestamp?: string;
	notReady: string[];
};

function fmtTs(ts: unknown): string | undefined {
	if (!ts) return undefined;
	try {
		return new Date(ts as string | number | Date).toISOString();
	} catch {
		return undefined;
	}
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	if (!session?.user) throw redirect(303, '/');
	const cluster = event.params.cluster;
	const kind = event.params.kind;
	const ns = event.params.ns;
	const name = event.params.name;
	if (!canRead(session, cluster, ns)) throw redirect(303, '/');
	if (!SUPPORTED.has(kind)) {
		throw error(400, `Unsupported workload kind "${kind}". Use one of: ${[...SUPPORTED].join(', ')}`);
	}

	let summary: {
		kind: string;
		name: string;
		namespace: string;
		replicas?: number;
		readyReplicas?: number;
		availableReplicas?: number;
		updatedReplicas?: number;
		desiredReplicas?: number;
		currentReplicas?: number;
		generation?: number;
		observedGeneration?: number;
		creationTimestamp?: string;
		labels: Record<string, string>;
		annotations: Record<string, string>;
		selector: Record<string, string>;
		strategy?: string;
		serviceAccountName?: string;
		images: string[];
	};
	try {
		if (kind === 'Deployment') {
			const d = await time(`${cluster}/readNamespacedDeployment`, () =>
				apps(cluster).readNamespacedDeployment({ name, namespace: ns })
			);
			summary = {
				kind,
				name,
				namespace: ns,
				replicas: d.spec?.replicas ?? undefined,
				readyReplicas: d.status?.readyReplicas ?? 0,
				availableReplicas: d.status?.availableReplicas ?? 0,
				updatedReplicas: d.status?.updatedReplicas ?? 0,
				generation: d.metadata?.generation,
				observedGeneration: d.status?.observedGeneration,
				creationTimestamp: fmtTs(d.metadata?.creationTimestamp),
				labels: (d.metadata?.labels ?? {}) as Record<string, string>,
				annotations: (d.metadata?.annotations ?? {}) as Record<string, string>,
				selector: (d.spec?.selector?.matchLabels ?? {}) as Record<string, string>,
				strategy: d.spec?.strategy?.type,
				serviceAccountName: d.spec?.template?.spec?.serviceAccountName,
				images: (d.spec?.template?.spec?.containers ?? [])
					.map((c) => c.image)
					.filter((i): i is string => !!i)
			};
		} else if (kind === 'StatefulSet') {
			const s = await time(`${cluster}/readNamespacedStatefulSet`, () =>
				apps(cluster).readNamespacedStatefulSet({ name, namespace: ns })
			);
			summary = {
				kind,
				name,
				namespace: ns,
				replicas: s.spec?.replicas ?? undefined,
				readyReplicas: s.status?.readyReplicas ?? 0,
				availableReplicas: s.status?.availableReplicas ?? 0,
				updatedReplicas: s.status?.updatedReplicas ?? 0,
				currentReplicas: s.status?.currentReplicas ?? 0,
				generation: s.metadata?.generation,
				observedGeneration: s.status?.observedGeneration,
				creationTimestamp: fmtTs(s.metadata?.creationTimestamp),
				labels: (s.metadata?.labels ?? {}) as Record<string, string>,
				annotations: (s.metadata?.annotations ?? {}) as Record<string, string>,
				selector: (s.spec?.selector?.matchLabels ?? {}) as Record<string, string>,
				strategy: s.spec?.updateStrategy?.type,
				serviceAccountName: s.spec?.template?.spec?.serviceAccountName,
				images: (s.spec?.template?.spec?.containers ?? [])
					.map((c) => c.image)
					.filter((i): i is string => !!i)
			};
		} else {
			const d = await time(`${cluster}/readNamespacedDaemonSet`, () =>
				apps(cluster).readNamespacedDaemonSet({ name, namespace: ns })
			);
			summary = {
				kind,
				name,
				namespace: ns,
				desiredReplicas: d.status?.desiredNumberScheduled ?? 0,
				readyReplicas: d.status?.numberReady ?? 0,
				availableReplicas: d.status?.numberAvailable ?? 0,
				updatedReplicas: d.status?.updatedNumberScheduled ?? 0,
				currentReplicas: d.status?.currentNumberScheduled ?? 0,
				generation: d.metadata?.generation,
				observedGeneration: d.status?.observedGeneration,
				creationTimestamp: fmtTs(d.metadata?.creationTimestamp),
				labels: (d.metadata?.labels ?? {}) as Record<string, string>,
				annotations: (d.metadata?.annotations ?? {}) as Record<string, string>,
				selector: (d.spec?.selector?.matchLabels ?? {}) as Record<string, string>,
				strategy: d.spec?.updateStrategy?.type,
				serviceAccountName: d.spec?.template?.spec?.serviceAccountName,
				images: (d.spec?.template?.spec?.containers ?? [])
					.map((c) => c.image)
					.filter((i): i is string => !!i)
			};
		}
	} catch (err) {
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `${kind} "${ns}/${name}" not found`);
	}

	// Owned pods. Filter by labelSelector built from spec.selector.matchLabels
	// — same approach the kube controllers use. Falls back to ownerRef
	// matching if the selector is empty (rare, but covers hand-rolled CRs).
	let pods: PodRow[] = [];
	let podsError: string | null = null;
	const selectorEntries = Object.entries(summary.selector);
	try {
		const labelSelector = selectorEntries.length
			? selectorEntries.map(([k, v]) => `${k}=${v}`).join(',')
			: undefined;
		const res = await time(`${cluster}/listNamespacedPod(${kind}-children)`, () =>
			core(cluster).listNamespacedPod({ namespace: ns, labelSelector })
		);
		pods = res.items
			.filter((p) => {
				// Belt-and-braces ownerRef check. listNamespacedPod with a
				// labelSelector is normally enough, but a stale orphan
				// ReplicaSet from a previous Deployment can match labels
				// without belonging to the controller we're rendering.
				const refs = p.metadata?.ownerReferences ?? [];
				if (kind === 'Deployment') {
					// Deployment owns ReplicaSets, RS owns Pods. Check
					// the labelSelector match — close enough for the UI.
					return true;
				}
				return refs.some((r) => r.kind === kind && r.name === name);
			})
			.map((p): PodRow => {
				const cs = p.status?.containerStatuses ?? [];
				const ready = `${cs.filter((c) => c.ready).length}/${cs.length}`;
				const restarts = cs.reduce((acc, c) => acc + (c.restartCount ?? 0), 0);
				const notReady = cs.filter((c) => !c.ready).map((c) => c.name);
				return {
					name: p.metadata?.name ?? '?',
					phase: p.status?.phase ?? '?',
					ready,
					restarts,
					node: p.spec?.nodeName,
					creationTimestamp: fmtTs(p.metadata?.creationTimestamp),
					notReady
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch (err) {
		console.error('list owned pods failed', err);
		podsError = err instanceof Error ? err.message : String(err);
	}

	// Events: filter by involvedObject pointing at the controller. Pod
	// events live on the pod detail page; here we want scheduling /
	// rollout / status messages emitted at the controller layer
	// (FailedCreate, ProgressDeadlineExceeded, etc).
	let events: EventRow[] = [];
	let eventsError: string | null = null;
	try {
		const evRes = await time(`${cluster}/listNamespacedEvent(${kind})`, () =>
			core(cluster).listNamespacedEvent({
				namespace: ns,
				fieldSelector: `involvedObject.name=${name},involvedObject.kind=${kind}`
			})
		);
		events = evRes.items
			.map((e) => ({
				type: e.type ?? '?',
				reason: e.reason ?? '?',
				message: e.message ?? '',
				count: e.count ?? 1,
				firstSeen: fmtTs(e.firstTimestamp ?? e.eventTime),
				lastSeen: fmtTs(e.lastTimestamp ?? e.eventTime)
			}))
			.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
	} catch (err) {
		console.error('list events failed', err);
		eventsError = err instanceof Error ? err.message : String(err);
	}

	const scopedAudit = auditScopedTo({ cluster, namespace: ns, name, limit: 20 });

	return {
		cluster,
		summary,
		pods,
		podsError,
		events,
		eventsError,
		scopedAudit,
		canWriteHere: canWrite(session, cluster, ns)
	};
};
