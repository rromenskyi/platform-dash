import { json, type RequestHandler } from '@sveltejs/kit';
import { findPlugin, canUsePlugin, rewriteLocation } from '$lib/plugins.server';
import { currentAccessToken } from '$lib/session-token.server';

// Plugin API proxy: /plugin-api/<id>/<path> → <plugin url>/<path>.
//
// Forwards the signed-in user's access token as a Bearer token and
// nothing else of dash's: request and response headers are allow-
// listed, cookies never cross in either direction. The plugin back end
// validates the token with the IdP itself. Bodies stream back, so SSE
// works; only the wait for response headers is bounded.

const BODY_CAP = 10 * 1024 * 1024;
const HEADERS_TIMEOUT_MS = 30_000;

const REQ_HEADERS = [
	'accept',
	'accept-language',
	'content-type',
	'cache-control',
	'if-match',
	'if-none-match',
	'if-modified-since',
	'if-unmodified-since',
	'range',
	'x-request-id'
];
const RES_HEADERS = [
	'content-type',
	'cache-control',
	'etag',
	'last-modified',
	'expires',
	'content-disposition',
	'content-range',
	'accept-ranges',
	'vary',
	'retry-after'
];

const sessionExpired = () => json({ error: 'session_expired' }, { status: 401 });

export const fallback: RequestHandler = async ({ params, request, url, locals, getClientAddress }) => {
	const plugin = findPlugin(params.id ?? '');
	if (!plugin) return json({ error: 'unknown_plugin' }, { status: 404 });

	const segments = (params.path ?? '').split('/');
	if (segments.some((s) => s === '.' || s === '..')) {
		return json({ error: 'bad_path' }, { status: 400 });
	}

	// Runs the jwt callback: refreshes a near-expiry token and persists
	// the new cookie before we read it below.
	const session = await locals.auth();
	if (!session?.user) return sessionExpired();
	if (!canUsePlugin(session, plugin)) return json({ error: 'forbidden' }, { status: 403 });
	const accessToken = await currentAccessToken(request);
	if (!accessToken) return sessionExpired();

	const base = `/plugin-api/${plugin.id}`;
	const target = `${plugin.url}/${segments.map(encodeURIComponent).join('/')}${url.search}`;

	const headers = new Headers();
	for (const h of REQ_HEADERS) {
		const v = request.headers.get(h);
		if (v !== null) headers.set(h, v);
	}
	headers.set('authorization', `Bearer ${accessToken}`);
	headers.set('x-forwarded-prefix', base);
	headers.set('x-forwarded-host', url.host);
	headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
	try {
		headers.set('x-forwarded-for', getClientAddress());
	} catch {
		/* not available (tests) */
	}

	let body: ArrayBuffer | undefined;
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		const declared = Number(request.headers.get('content-length') ?? 0);
		if (declared > BODY_CAP) return json({ error: 'body_too_large' }, { status: 413 });
		const buf = await readCapped(request, BODY_CAP);
		if (buf === null) return json({ error: 'body_too_large' }, { status: 413 });
		body = buf;
	}

	// Abort upstream if the client goes away; bound only the wait for
	// response headers so long streams survive.
	const ac = new AbortController();
	const onAbort = () => ac.abort();
	request.signal.addEventListener('abort', onAbort);
	const timer = setTimeout(() => ac.abort(new Error('timeout')), HEADERS_TIMEOUT_MS);
	let upstream: Response;
	try {
		upstream = await fetch(target, {
			method: request.method,
			headers,
			body,
			redirect: 'manual',
			signal: ac.signal
		});
	} catch {
		request.signal.removeEventListener('abort', onAbort);
		const timedOut = ac.signal.reason instanceof Error && ac.signal.reason.message === 'timeout';
		return json(
			{ error: timedOut ? 'plugin_timeout' : 'plugin_unreachable' },
			{ status: timedOut ? 504 : 502 }
		);
	} finally {
		clearTimeout(timer);
	}

	const out = new Headers();
	for (const h of RES_HEADERS) {
		const v = upstream.headers.get(h);
		if (v !== null) out.set(h, v);
	}
	const loc = upstream.headers.get('location');
	if (loc !== null) out.set('location', rewriteLocation(loc, plugin.url, base));
	out.set('x-content-type-options', 'nosniff');

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: out
	});
};

async function readCapped(request: Request, cap: number): Promise<ArrayBuffer | null> {
	if (!request.body) return new ArrayBuffer(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > cap) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const buf = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		buf.set(c, off);
		off += c.length;
	}
	return buf.buffer;
}
