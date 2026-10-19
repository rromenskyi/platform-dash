import { parseCpuMilli, parseMemBytes } from './quantity';
import { isPodFailing } from './pod-health';

// Per-namespace and per-pod resource picture from pod specs/statuses
// plus (optional) metrics-server usage. Pure: the loader fetches, this
// only adds things up, so it can be tested without a cluster.

type Resources = { requests?: Record<string, string>; limits?: Record<string, string> };
export type PodIn = {
	metadata?: { name?: string; namespace?: string };
	spec?: { containers?: Array<{ name: string; resources?: Resources }> };
	status?: {
		phase?: string;
		containerStatuses?: Array<{
			name?: string;
			ready?: boolean;
			restartCount?: number;
			state?: { waiting?: { reason?: string } };
			lastState?: { terminated?: { reason?: string; finishedAt?: string | Date } };
		}>;
	};
};
export type PodMetricsIn = {
	metadata: { name: string; namespace?: string };
	containers: Array<{ usage: { cpu?: string; memory?: string } }>;
};

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
	for (const p of pods) {
		const namespace = p.metadata?.namespace ?? '?';
		const name = p.metadata?.name ?? '?';
		const phase = p.status?.phase ?? '?';
		// Finished pods (Jobs) hold no resources; keep them out of the sums.
		const active = phase !== 'Succeeded' && phase !== 'Failed';
		let cpuReq = 0,
			cpuLim = 0,
			memReq = 0,
			memLim = 0;
		for (const c of p.spec?.containers ?? []) {
			cpuReq += parseCpuMilli(c.resources?.requests?.cpu);
			cpuLim += parseCpuMilli(c.resources?.limits?.cpu);
			memReq += parseMemBytes(c.resources?.requests?.memory);
			memLim += parseMemBytes(c.resources?.limits?.memory);
		}
		const statuses = p.status?.containerStatuses ?? [];
		const restarts = statuses.reduce((a, c) => a + (c.restartCount ?? 0), 0);
		const lastTerm = statuses.find((c) => c.lastState?.terminated)?.lastState?.terminated;
		const oom = statuses.some((c) => {
			const t = c.lastState?.terminated;
			if (t?.reason !== 'OOMKilled') return false;
			const at = t.finishedAt ? new Date(t.finishedAt).getTime() : 0;
			return !at || nowMs - at < DAY_MS;
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
			ns = {
				namespace,
				pods: 0,
				running: 0,
				failing: 0,
				restarts: 0,
				oom24h: 0,
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
		}
		if (u) {
			ns.cpuUsedMilli = (ns.cpuUsedMilli ?? 0) + u.cpu;
			ns.memUsedBytes = (ns.memUsedBytes ?? 0) + u.mem;
		}
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
