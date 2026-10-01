import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canWrite } from '$lib/authz';
import { record } from '$lib/audit.server';
import { readJson } from '$lib/csrf.server';

// Server-side HTTP tester. Fetches arbitrary URLs (http/https only)
// from inside the dash pod with operator-supplied method, headers,
// and body. Returns status, response headers, timing, and a body
// snippet. Useful for testing ingress routes, hitting internal-only
// services from within the cluster, and debugging "does this token
// work?" without leaving the dash.
//
// Cluster-agnostic — moved out of /k8s/[cluster]/api/ingress-test
// since the tool doesn't care which cluster you're "in". Gate is on
// global `canWrite(session)` (no cluster arg) so cluster-scoped
// `cluster_<x>_admin` roles can't open it. Audit logs URL + method
// + final status; headers and body are NEVER logged (Bearer tokens,
// basic auth, etc).

const TIMEOUT_MS = 10_000;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SNIPPET_CAP = 64_000;

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = await locals.auth();
	if (!canWrite(session)) {
		throw error(403, 'platform_admin role required');
	}

	const body = await readJson<{
		url?: string;
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	}>(request);
	if (!body.url) throw error(400, 'url required');

	let parsed: URL;
	try {
		parsed = new URL(body.url);
	} catch {
		throw error(400, 'invalid url');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw error(400, `unsupported scheme: ${parsed.protocol}`);
	}
	const method = (body.method ?? 'GET').toUpperCase();
	if (!ALLOWED_METHODS.has(method)) {
		throw error(400, `unsupported method: ${method}`);
	}

	// Only allow body on methods that take one. Don't infer
	// content-type — operator sets it in the headers map if they want
	// JSON / form / etc.
	const fetchInit: RequestInit = {
		method,
		redirect: 'manual',
		headers: {
			'user-agent': 'platform-dash/http-test',
			...(body.headers ?? {})
		}
	};
	if (body.body && method !== 'GET' && method !== 'HEAD') {
		fetchInit.body = body.body;
	}

	const auditBase = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		// HTTP tester is global; no cluster context. Audit ring's
		// cluster field is 'tools' so the /admin/audit cluster filter
		// shows it under a stable bucket.
		cluster: 'tools',
		action: 'http-test',
		// URL + method only — headers and body intentionally omitted.
		target: { kind: 'HTTP', url: parsed.toString(), method }
	};

	const start = performance.now();
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
	fetchInit.signal = ac.signal;
	try {
		const res = await fetch(parsed.toString(), fetchInit);
		const ms = Math.round(performance.now() - start);
		// Pass back ALL response headers — they're a public part of
		// what the server returned, no secrecy concern, and the
		// operator may need any of them when debugging.
		const responseHeaders: Record<string, string> = {};
		for (const [k, v] of res.headers) responseHeaders[k] = v;

		// Read at most SNIPPET_CAP bytes of the body. The reader is
		// chunked so a 10 GB stream doesn't eat the dash's memory.
		let snippet: string | null = null;
		let truncated = false;
		try {
			const reader = res.body?.getReader();
			if (reader) {
				const chunks: Uint8Array[] = [];
				let total = 0;
				while (total < SNIPPET_CAP) {
					const { done, value } = await reader.read();
					if (done || !value) break;
					chunks.push(value);
					total += value.length;
				}
				if (total >= SNIPPET_CAP) truncated = true;
				const buf = new Uint8Array(Math.min(total, SNIPPET_CAP));
				let off = 0;
				for (const c of chunks) {
					const room = SNIPPET_CAP - off;
					if (room <= 0) break;
					const slice = c.slice(0, Math.min(c.length, room));
					buf.set(slice, off);
					off += slice.length;
				}
				snippet = new TextDecoder('utf-8', { fatal: false }).decode(buf);
			}
			try {
				await res.body?.cancel();
			} catch {
				/* */
			}
		} catch {
			snippet = null;
		}

		record({
			...auditBase,
			outcome: 'ok',
			message: `${res.status}`,
			durationMs: ms
		});
		return json({
			ok: true,
			status: res.status,
			statusText: res.statusText,
			ms,
			headers: responseHeaders,
			snippet,
			truncated
		});
	} catch (err) {
		const ms = Math.round(performance.now() - start);
		const aborted = err instanceof Error && err.name === 'AbortError';
		const msg = aborted
			? `timeout after ${TIMEOUT_MS}ms`
			: err instanceof Error
				? err.message
				: String(err);
		record({
			...auditBase,
			outcome: 'error',
			message: msg,
			durationMs: ms
		});
		return json({ ok: false, error: msg, ms });
	} finally {
		clearTimeout(timer);
	}
};
