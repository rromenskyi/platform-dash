// Tiny human-friendly age-since helper. The k8s API surfaces every
// timestamp as ISO 8601, but operators read "3d", "12m" faster than
// raw RFC strings. Inputs may be Date | string | undefined; missing
// values fall through to "—" so the UI never explodes on a partial
// fixture.
//
// Pure function, no Node deps — safe to import from .svelte components.
// The k8s API client lives in `k8s.server.ts` (SvelteKit's `.server.ts`
// suffix keeps it out of the client bundle).
export function age(ts: Date | string | undefined): string {
	if (!ts) return '—';
	const t = typeof ts === 'string' ? new Date(ts) : ts;
	const sec = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 48) return `${hr}h`;
	const d = Math.floor(hr / 24);
	return `${d}d`;
}
