// Kubernetes resource quantities → numbers. CPU in millicores (usage
// from metrics-server comes as nanocores, "139403626n"), memory in bytes.

export function parseCpuMilli(v: string | undefined): number {
	if (!v) return 0;
	if (v.endsWith('n')) return parseFloat(v) / 1_000_000;
	if (v.endsWith('u') || v.endsWith('µ')) return parseFloat(v) / 1_000;
	if (v.endsWith('m')) return parseFloat(v);
	const n = parseFloat(v);
	return Number.isFinite(n) ? n * 1000 : 0;
}

const MEM_UNITS: Record<string, number> = {
	Ki: 1024,
	Mi: 1024 ** 2,
	Gi: 1024 ** 3,
	Ti: 1024 ** 4,
	k: 1000,
	K: 1000,
	M: 1000 ** 2,
	G: 1000 ** 3,
	T: 1000 ** 4
};

export function parseMemBytes(v: string | undefined): number {
	if (!v) return 0;
	const m = /^([\d.]+(?:e\d+)?)([a-zA-Z]*)$/.exec(v);
	if (!m) return 0;
	const num = parseFloat(m[1]);
	if (!Number.isFinite(num)) return 0;
	return num * (m[2] ? (MEM_UNITS[m[2]] ?? 1) : 1);
}

export function fmtCpu(milli: number): string {
	if (milli >= 1000) return `${(milli / 1000).toFixed(milli >= 10_000 ? 0 : 2)} cores`;
	return `${Math.round(milli)}m`;
}

export function fmtBytes(b: number): string {
	const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
	let v = b;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
