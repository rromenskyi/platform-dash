import { parseCpuMilli, parseMemBytes } from './quantity';
import { isPodFailing } from './pod-health';

// Per-namespace and per-pod resource picture from pod specs/statuses
// plus (optional) metrics-server usage. Pure: the loader fetches, this
// only adds things up, so it can be tested without a cluster.

type Resources = { requests?: Record<string, string>; limits?: Record<string, string> };
type Terminated = { reason?: string; exitCode?: number; finishedAt?: string | Date };
type ContainerStatus = {
	name?: string;
	ready?: boolean;
	restartCount?: number;
	state?: { waiting?: { reason?: string }; terminated?: Terminated };
	lastState?: { terminated?: Terminated };
};
type ContainerSpec = { name: string; resources?: Resources; restartPolicy?: string };
export type PodIn = {
	metadata?: { name?: string; namespace?: string };
	spec?: { containers?: ContainerSpec[]; initContainers?: ContainerSpec[] };
	status?: {
		phase?: string;
		containerStatuses?: ContainerStatus[];
		initContainerStatuses?: ContainerStatus[];
	};
};
export type PodMetricsIn = {
	metadata: { name: string; namespace?: string };
	containers: Array<{ usage: { cpu?: string; memory?: string } }>;
};

// Limits are only meaningful as a ceiling when *every* container in
// scope has one; otherwise usage of the unlimited ones would be
// compared against a partial sum. A limit of 0 therefore means "not
// fully limited". Requests are reported as summed (a reference, not a
// cap).
export type Usage = {
	cpuUsedMilli: number | null; // null: no metrics for this pod
	cpuRequestMilli: number;
	cpuLimitMilli: number;
	memUsedBytes: number | null;
	memRequestBytes: number;
	memLimitBytes: number;
};
export type PodRow = Usage & {
	namespace: string;
	name: string;
	phase: string;
	failing: boolean;
	restarts: number;
	lastTermination?: string;
};
export type NamespaceRow = Usage & {
	namespace: string;
	pods: number;
	running: number;
	failing: number;
	restarts: number;
	oom24h: number;
	// Some active pods have no metrics sample: usage is a lower bound.
	metricsPartial: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function summarize(pods: PodIn[], podMetrics: PodMetricsIn[] | null, nowMs: number) {
	const usage = new Map<string, { cpu: number; mem: number }>();
	for (const m of podMetrics ?? []) {
		let cpu = 0;
		let mem = 0;
		for (const c of m.containers ?? []) {
			cpu += parseCpuMilli(c.usage?.cpu);
			mem += parseMemBytes(c.usage?.memory);
		}
		usage.set(`${m.metadata.namespace}/${m.metadata.name}`, { cpu, mem });
	}

	const podRows: PodRow[] = [];
	const byNs = new Map<string, NamespaceRow>();
	const nsFullyLimited = new Map<string, { cpu: boolean; mem: boolean }>();
	for (const p of pods) {
		const namespace = p.metadata?.namespace ?? '?';
		const name = p.metadata?.name ?? '?';
		const phase = p.status?.phase ?? '?';
		// Finished pods (Jobs) hold no resources; keep them out of the sums.
		const active = phase !== 'Succeeded' && phase !== 'Failed';
		let cpuReq = 0,
			cpuLim = 0,
			memReq = 0,
			memLim = 0,
			cpuLimited = true,
			memLimited = true;
		// Native sidecars (init containers with restartPolicy: Always) run
		// alongside the app and count; plain init containers have exited.
		const running = [
			...(p.spec?.containers ?? []),
			...(p.spec?.initContainers ?? []).filter((c) => c.restartPolicy === 'Always')
		];
		for (const c of running) {
			cpuReq += parseCpuMilli(c.resources?.requests?.cpu);
			memReq += parseMemBytes(c.resources?.requests?.memory);
			const cl = parseCpuMilli(c.resources?.limits?.cpu);
			const ml = parseMemBytes(c.resources?.limits?.memory);
			if (cl > 0) cpuLim += cl;
			else cpuLimited = false;
			if (ml > 0) memLim += ml;
			else memLimited = false;
		}
		if (!cpuLimited) cpuLim = 0;
		if (!memLimited) memLim = 0;
		const statuses = [...(p.status?.containerStatuses ?? []), ...(p.status?.initContainerStatuses ?? [])];
		const restarts = statuses.reduce((a, c) => a + (c.restartCount ?? 0), 0);
		// Current termination first (e.g. a Job that OOMed and stays Failed),
		// then the previous one.
		const terms = statuses.flatMap((c) => [c.state?.terminated, c.lastState?.terminated]).filter(
			(t): t is Terminated => !!t
		);
		const lastTerm = terms.find((t) => t.reason && t.reason !== 'Completed');
		const oom = terms.some((t) => {
			if (t.reason !== 'OOMKilled' || !t.finishedAt) return false;
			const at = new Date(t.finishedAt).getTime();
			return Number.isFinite(at) && nowMs - at < DAY_MS;
		});
		const u = usage.get(`${namespace}/${name}`);
		const failing = isPodFailing(p);

		const row: PodRow = {
			namespace,
			name,
			phase,
			failing,
			restarts,
			lastTermination: lastTerm?.reason,
			cpuUsedMilli: u ? u.cpu : null,
			cpuRequestMilli: cpuReq,
			cpuLimitMilli: cpuLim,
			memUsedBytes: u ? u.mem : null,
			memRequestBytes: memReq,
			memLimitBytes: memLim
		};
		podRows.push(row);

		let ns = byNs.get(namespace);
		if (!ns) {
			nsFullyLimited.set(namespace, { cpu: true, mem: true });
			ns = {
				namespace,
				pods: 0,
				running: 0,
				failing: 0,
				restarts: 0,
				oom24h: 0,
				metricsPartial: false,
				cpuUsedMilli: null,
				cpuRequestMilli: 0,
				cpuLimitMilli: 0,
				memUsedBytes: null,
				memRequestBytes: 0,
				memLimitBytes: 0
			};
			byNs.set(namespace, ns);
		}
		ns.pods++;
		if (phase === 'Running') ns.running++;
		if (failing) ns.failing++;
		ns.restarts += restarts;
		if (oom) ns.oom24h++;
		if (active) {
			ns.cpuRequestMilli += cpuReq;
			ns.cpuLimitMilli += cpuLim;
			ns.memRequestBytes += memReq;
			ns.memLimitBytes += memLim;
			const lim = nsFullyLimited.get(namespace)!;
			lim.cpu &&= cpuLimited;
			lim.mem &&= memLimited;
		}
		// Usage only for active pods, matching the denominators.
		if (active && u) {
			ns.cpuUsedMilli = (ns.cpuUsedMilli ?? 0) + u.cpu;
			ns.memUsedBytes = (ns.memUsedBytes ?? 0) + u.mem;
		}
		if (active && !u && podMetrics) ns.metricsPartial = true;
	}

	for (const ns of byNs.values()) {
		if (ns.cpuUsedMilli === null) ns.metricsPartial = false; // nothing measured at all
		const lim = nsFullyLimited.get(ns.namespace)!;
		if (!lim.cpu) ns.cpuLimitMilli = 0;
		if (!lim.mem) ns.memLimitBytes = 0;
	}
	const namespaces = [...byNs.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
	// Busiest first, problems on top.
	podRows.sort(
		(a, b) =>
			Number(b.failing) - Number(a.failing) ||
			(b.memUsedBytes ?? 0) - (a.memUsedBytes ?? 0) ||
			a.name.localeCompare(b.name)
	);
	return { namespaces, pods: podRows };
}
