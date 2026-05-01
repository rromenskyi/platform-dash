// Process-wide registry of active Live SSE streams. Browsers cap
// concurrent HTTP/1.1 connections per origin at 6; a long-lived SSE
// holds one slot indefinitely. SvelteKit's `goto()` waits on a load
// fetch that needs an HTTP slot, so navigating with multiple Live
// streams open can deadlock the page (especially in dev / behind
// proxies that don't speak HTTP/2 to the browser).
//
// Two policies enforced here:
//   1. Single slot — opening a new Live closes any existing ones.
//   2. closeAll() before navigation — selector / saved-views handlers
//      call this so the goto's load fetch isn't blocked by a slot
//      held by an SSE we're about to discard anyway.
//
// Registry keys are arbitrary strings — usually `${kind}:${id}`. The
// closer fn is whatever shuts the source down (es.close(),
// AbortController.abort(), etc).

type Closer = () => void;

const registry = new Map<string, Closer>();

export function registerLive(key: string, close: Closer): void {
	// Singleton policy: any prior owner of this key, or any other
	// live stream at all, gets closed first.
	closeAll();
	registry.set(key, close);
}

export function unregisterLive(key: string): void {
	const c = registry.get(key);
	if (c) {
		try {
			c();
		} catch {
			/* */
		}
		registry.delete(key);
	}
}

export function closeAll(): void {
	for (const [, c] of registry) {
		try {
			c();
		} catch {
			/* */
		}
	}
	registry.clear();
}

export function activeCount(): number {
	return registry.size;
}
