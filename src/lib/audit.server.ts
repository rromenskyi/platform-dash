// Audit log for write actions. One JSON line per attempt to stdout —
// the SvelteKit Node container's stdout is what Loki / kubectl logs
// see, so this is durable enough for "who restarted prod at 3am"
// without standing up a database. Every field stays on a single line
// so log shippers can split on \n without surprise.
//
// In addition to stdout, the most recent N events are kept in an
// in-memory ring buffer so /admin/audit can render a quick read view
// without standing up Loki access in the dash. Restarts wipe the ring
// (intentional — durable history is in stdout, not here).
//
// Outcomes: "ok" / "denied" (RBAC) / "error" (k8s API rejected). The
// caller is responsible for invoking record() *after* determining the
// outcome so we don't log "ok" for actions that failed mid-flight.

export type AuditOutcome = 'ok' | 'denied' | 'error';

export type AuditEvent = {
	user: string;
	roles: string[];
	cluster: string;
	action: string;
	target: { kind?: string; namespace?: string; name?: string; [k: string]: unknown };
	outcome: AuditOutcome;
	message?: string;
	durationMs?: number;
};

export type AuditRecord = AuditEvent & { ts: string };

const RING_SIZE = 1000;
const ring: AuditRecord[] = [];
let cursor = 0;

export function record(ev: AuditEvent): void {
	const rec: AuditRecord = { ts: new Date().toISOString(), ...ev };
	const line = JSON.stringify({ kind: 'audit', ...rec });
	// stderr would also work, but stdout matches the rest of the app's
	// info logging — pino-style consumers split by JSON `level` later.
	console.log(line);
	if (ring.length < RING_SIZE) {
		ring.push(rec);
	} else {
		ring[cursor] = rec;
		cursor = (cursor + 1) % RING_SIZE;
	}
}

export function auditSnapshot(): AuditRecord[] {
	// Return newest-first regardless of where the cursor is.
	const out = ring.slice();
	out.sort((a, b) => b.ts.localeCompare(a.ts));
	return out;
}

// Filter the ring to entries that touched a specific resource. Used
// by detail pages (e.g. pod) to render "recent actions on this
// resource". Match is strict on kind+namespace+name — we don't try
// to track resources across rename / recreation cycles.
export function auditScopedTo(opts: {
	cluster?: string;
	kind?: string;
	namespace?: string;
	name?: string;
	limit?: number;
}): AuditRecord[] {
	const limit = opts.limit ?? 50;
	const out: AuditRecord[] = [];
	for (const r of auditSnapshot()) {
		if (opts.cluster && r.cluster !== opts.cluster) continue;
		if (opts.kind && r.target?.kind !== opts.kind) continue;
		if (opts.namespace && r.target?.namespace !== opts.namespace) continue;
		if (opts.name && r.target?.name !== opts.name) continue;
		out.push(r);
		if (out.length >= limit) break;
	}
	return out;
}

// Wrap an async write op so callers don't have to manually time +
// branch on success/failure. Throws whatever the op throws after
// logging — the endpoint handler still owns the response shape.
export async function audited<T>(
	base: Omit<AuditEvent, 'outcome' | 'message' | 'durationMs'>,
	op: () => Promise<T>
): Promise<T> {
	const start = performance.now();
	try {
		const out = await op();
		record({ ...base, outcome: 'ok', durationMs: Math.round(performance.now() - start) });
		return out;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// 403/401 from the apiserver = RBAC denial. The SDK sets `code`
		// on its error type; we treat anything else as a generic error.
		const code =
			typeof err === 'object' && err !== null && 'code' in err
				? (err as { code: number }).code
				: undefined;
		const outcome: AuditOutcome = code === 401 || code === 403 ? 'denied' : 'error';
		record({
			...base,
			outcome,
			message: msg,
			durationMs: Math.round(performance.now() - start)
		});
		throw err;
	}
}
