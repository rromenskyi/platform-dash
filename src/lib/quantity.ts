// Kubernetes resource quantities → numbers. CPU in millicores (usage
// from metrics-server comes as nanocores, "139403626n"), memory in bytes.

// Kubernetes quantity grammar: a decimal (optionally with exponent)
// and an optional suffix — binary (Ki…Ei), decimal (n u m k M G T P E).
// Unknown or malformed input yields 0 rather than a wrong number.
const SUFFIX: Record<string, number> = {
	n: 1e-9,
	u: 1e-6,
	µ: 1e-6,
	m: 1e-3,
	'': 1,
	k: 1e3,
	M: 1e6,
	G: 1e9,
	T: 1e12,
	P: 1e15,
	E: 1e18,
	Ki: 2 ** 10,
	Mi: 2 ** 20,
	Gi: 2 ** 30,
	Ti: 2 ** 40,
	Pi: 2 ** 50,
	Ei: 2 ** 60
};
const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|n|u|µ|m|k|M|G|T|P|E)?$/;

export function parseQuantity(v: string | undefined): number {
	if (!v) return 0;
	const m = QUANTITY.exec(v.trim());
	if (!m) return 0;
	const n = parseFloat(m[1]) * SUFFIX[m[2] ?? ''];
	return Number.isFinite(n) ? n : 0;
}

export function parseCpuMilli(v: string | undefined): number {
	return parseQuantity(v) * 1000;
}

export function parseMemBytes(v: string | undefined): number {
	return parseQuantity(v);
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
