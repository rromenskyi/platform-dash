// Tiny line-by-line diff. Pure JS, no deps. Used by the CRD instance
// edit preview to show what's changing before save — Kubernetes
// rejects concurrent edits with 409 and the user has no way to know
// what diverged otherwise. This isn't trying to compete with Myers'
// diff — it's an LCS table for two short blobs (a typical CRD spec
// is well under a few hundred lines), then a backtrace into a list of
// {kind, value} ops.

export type DiffOp = { kind: 'same' | 'add' | 'del'; line: string };

export function lineDiff(before: string, after: string): DiffOp[] {
	const a = before.split('\n');
	const b = after.split('\n');
	const m = a.length;
	const n = b.length;
	// LCS length table. Int16Array is enough for any realistic input;
	// ~640 KB at 400×400 is fine and avoids a per-cell GC churn.
	const dp = new Int32Array((m + 1) * (n + 1));
	const w = n + 1;
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (a[i] === b[j]) {
				dp[i * w + j] = dp[(i + 1) * w + (j + 1)] + 1;
			} else {
				dp[i * w + j] = Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
			}
		}
	}
	const out: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			out.push({ kind: 'same', line: a[i] });
			i++;
			j++;
		} else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
			out.push({ kind: 'del', line: a[i] });
			i++;
		} else {
			out.push({ kind: 'add', line: b[j] });
			j++;
		}
	}
	while (i < m) out.push({ kind: 'del', line: a[i++] });
	while (j < n) out.push({ kind: 'add', line: b[j++] });
	return out;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const o of ops) {
		if (o.kind === 'add') added++;
		else if (o.kind === 'del') removed++;
	}
	return { added, removed };
}
