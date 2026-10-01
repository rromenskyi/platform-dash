// place files you want to import through the `$lib` alias in this folder.

// Race a promise against a deadline. On timeout the returned promise
// rejects with a labelled Error so the caller's existing catch can
// produce a UI-friendly "ok: false" payload — converting silent hangs
// (DB connection wedged, k8s API not responding, ioredis offline-queue
// stuck) into visible error rows on the page. Without this every slow
// loader trips Cloudflare Tunnel's 100s origin timeout (524) instead.
//
// The race doesn't cancel `p`. For resource acquisition (pool.connect,
// getConnection) pass `onLate` so a value that arrives after the
// deadline is handed back (e.g. released) instead of leaking — two
// late connections were enough to wedge a `max: 2` pool for good.
export function withDeadline<T>(
	p: Promise<T>,
	ms: number,
	label: string,
	onLate?: (value: T) => void
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, rej) => {
		timer = setTimeout(() => {
			if (onLate) p.then(onLate, () => {});
			rej(new Error(`${label} timed out after ${ms}ms`));
		}, ms);
	});
	return Promise.race([p, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}
