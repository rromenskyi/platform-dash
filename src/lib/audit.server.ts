// Audit log for write actions. One JSON line per attempt to stdout —
// the SvelteKit Node container's stdout is what Loki / kubectl logs
// see, so this is durable enough for "who restarted prod at 3am"
// without standing up a database. Every field stays on a single line
// so log shippers can split on \n without surprise.
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

export function record(ev: AuditEvent): void {
	const line = JSON.stringify({ kind: 'audit', ts: new Date().toISOString(), ...ev });
	// stderr would also work, but stdout matches the rest of the app's
	// info logging — pino-style consumers split by JSON `level` later.
	console.log(line);
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
