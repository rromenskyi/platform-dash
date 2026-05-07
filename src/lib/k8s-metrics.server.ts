// In-memory ring buffer of the most recent k8s API call latencies.
// Lives in module scope so the SvelteKit server process accumulates
// samples across requests; restarts wipe it (intentional — this is a
// rolling self-monitoring view, not a long-term metrics sink).
//
// Ring size is fixed; stats are computed on demand. Cheap enough at
// 500 samples that recomputing on every /admin/metrics hit beats the
// complexity of an incremental percentile estimator.

const RING_SIZE = 500;

type Sample = {
	op: string;
	ms: number;
	ok: boolean;
	at: number;
};

const ring: Sample[] = [];
let cursor = 0;

export function recordK8sCall(op: string, ms: number, ok: boolean): void {
	const sample: Sample = { op, ms, ok, at: Date.now() };
	if (ring.length < RING_SIZE) {
		ring.push(sample);
	} else {
		ring[cursor] = sample;
		cursor = (cursor + 1) % RING_SIZE;
	}
}

// Lightweight wrapper: time an async k8s call, push the sample, rethrow.
// Used as `await time('listPodForAllNamespaces', () => core().listPodForAllNamespaces())`.
export async function time<T>(op: string, fn: () => Promise<T>): Promise<T> {
	const start = performance.now();
	let ok = false;
	try {
		const out = await fn();
		ok = true;
		return out;
	} finally {
		recordK8sCall(op, performance.now() - start, ok);
	}
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx];
}

export type MetricsSnapshot = {
	count: number;
	errors: number;
	p50: number;
	p95: number;
	p99: number;
	maxAgeMs: number;
	perOp: Array<{ op: string; count: number; errors: number; p50: number; p95: number }>;
};

// Optional `windowMs` time-windows the snapshot — only samples taken
// within the last `windowMs` milliseconds are counted. Without it the
// snapshot covers the entire ring (up to RING_SIZE samples). The
// topbar pill uses the windowed variant so an error from an hour ago
// doesn't sit in the count forever, looking like an active fault.
export function snapshot(windowMs?: number): MetricsSnapshot {
	const cutoff = windowMs !== undefined ? Date.now() - windowMs : 0;
	const samples = windowMs !== undefined ? ring.filter((s) => s.at >= cutoff) : ring.slice();
	const all = samples.map((s) => s.ms).sort((a, b) => a - b);
	const errors = samples.filter((s) => !s.ok).length;
	const oldest = samples.reduce((acc, s) => Math.min(acc, s.at), Date.now());

	const byOp = new Map<string, Sample[]>();
	for (const s of samples) {
		const arr = byOp.get(s.op);
		if (arr) arr.push(s);
		else byOp.set(s.op, [s]);
	}

	const perOp = Array.from(byOp.entries())
		.map(([op, arr]) => {
			const sorted = arr.map((s) => s.ms).sort((a, b) => a - b);
			return {
				op,
				count: arr.length,
				errors: arr.filter((s) => !s.ok).length,
				p50: Math.round(percentile(sorted, 50)),
				p95: Math.round(percentile(sorted, 95))
			};
		})
		.sort((a, b) => b.count - a.count);

	return {
		count: samples.length,
		errors,
		p50: Math.round(percentile(all, 50)),
		p95: Math.round(percentile(all, 95)),
		p99: Math.round(percentile(all, 99)),
		maxAgeMs: samples.length ? Date.now() - oldest : 0,
		perOp
	};
}
