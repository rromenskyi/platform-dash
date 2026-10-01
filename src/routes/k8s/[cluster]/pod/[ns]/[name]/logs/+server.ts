import { error } from '@sveltejs/kit';
import { Writable } from 'node:stream';
import type { RequestHandler } from './$types';
import { logger } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canRead } from '$lib/authz';
import { isNamespaceName, isObjectName } from '$lib/k8s-names';

// SSE wrapper around `Log.log()` — k8s streams raw bytes; we split
// them on newlines and re-emit one `data: <line>` event per line so
// the browser EventSource client doesn't have to do any parsing.
//
// Auth: read role required (same gate as the rest of /k8s). Kept
// inline here because +server.ts files don't get the layout's
// `requireRead` for free — the layout only runs for page loads.
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	const session = await locals.auth();
	const { cluster, ns, name } = params;
	if (!isKnownCluster(cluster)) {
		throw error(404, `Unknown cluster "${cluster}"`);
	}
	// Log.log() builds the URL from raw ns/name — reject anything that
	// isn't a k8s name before it can path-traverse to another resource.
	if (!isNamespaceName(ns) || !isObjectName(name)) {
		throw error(400, 'invalid namespace or pod name');
	}
	// Pass cluster + ns so cluster-scoped and namespace-scoped readers
	// both get through. Without ns, namespace_<x>_sre operators would
	// be locked out of pods in their own namespace.
	if (!canRead(session, cluster, ns)) {
		throw error(403, 'read role for this cluster or namespace required');
	}

	const containerName = url.searchParams.get('container') || '';
	const follow = url.searchParams.get('follow') !== '0';
	const tailLines = clampInt(url.searchParams.get('tailLines'), 100, 1, 10000);
	const previous = url.searchParams.get('previous') === '1';
	const sinceSeconds = url.searchParams.get('sinceSeconds');
	const timestamps = url.searchParams.get('timestamps') === '1';

	const log = logger(cluster);

	// Wire the k8s SDK's Writable into a ReadableStream. The Writable
	// receives whatever raw bytes the API returns; we split on \n and
	// flush completed lines as SSE events. Trailing partial line stays
	// buffered until the next chunk (or the final flush on close).
	const encoder = new TextEncoder();
	let abortCtrl: AbortController | null = null;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let buffer = '';
			const writable = new Writable({
				write(chunk, _enc, cb) {
					buffer += chunk.toString('utf8');
					let nl: number;
					while ((nl = buffer.indexOf('\n')) >= 0) {
						const line = buffer.slice(0, nl);
						buffer = buffer.slice(nl + 1);
						controller.enqueue(encoder.encode(`data: ${line}\n\n`));
					}
					cb();
				},
				final(cb) {
					if (buffer.length > 0) {
						controller.enqueue(encoder.encode(`data: ${buffer}\n\n`));
						buffer = '';
					}
					controller.enqueue(encoder.encode('event: end\ndata: \n\n'));
					try {
						controller.close();
					} catch {
						/* already closed */
					}
					cb();
				}
			});

			try {
				abortCtrl = await log.log(ns, name, containerName, writable, {
					follow,
					tailLines,
					previous,
					timestamps,
					...(sinceSeconds ? { sinceSeconds: Number(sinceSeconds) || undefined } : {})
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				controller.enqueue(encoder.encode(`event: error\ndata: ${msg}\n\n`));
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			}

			// If the client navigates away, abort the upstream request so
			// we stop pulling logs we'll never deliver.
			request.signal.addEventListener('abort', () => {
				try {
					abortCtrl?.abort();
				} catch {
					/* already aborted */
				}
			});
		},
		cancel() {
			try {
				abortCtrl?.abort();
			} catch {
				/* already aborted */
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			// Disable buffering for nginx/Traefik in front of us — we want
			// each log line to flush immediately rather than wait for the
			// proxy's default chunk size.
			'x-accel-buffering': 'no'
		}
	});
};

function clampInt(raw: string | null, dflt: number, min: number, max: number): number {
	if (raw == null) return dflt;
	const n = parseInt(raw, 10);
	if (!Number.isFinite(n)) return dflt;
	return Math.max(min, Math.min(max, n));
}
