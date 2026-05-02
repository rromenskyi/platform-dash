import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { watcher } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canRead } from '$lib/authz';

// SSE feed of Event objects. Three modes by query string:
//   ?ns=&name=&kind=  → events for that single resource (pod detail).
//   ?ns=              → namespace-wide stream.
//   (no params)       → cluster-wide stream.
// The cluster-wide /events page hits the no-params form; the pod
// detail page hits the targeted form. Same wire shape regardless so
// the renderer can stay shared.
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);
	if (!canRead(session, cluster)) throw error(403, 'read role required');

	const ns = url.searchParams.get('ns');
	const name = url.searchParams.get('name');
	const kind = url.searchParams.get('kind') || 'Pod';

	const path = ns ? `/api/v1/namespaces/${ns}/events` : `/api/v1/events`;
	const queryParams: Record<string, string> = {};
	if (name) {
		queryParams.fieldSelector = `involvedObject.name=${name},involvedObject.kind=${kind}`;
	}

	const w = watcher(cluster);
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;
			let aborter: AbortController | null = null;
			function emit(payload: object) {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
				} catch {
					closed = true;
				}
			}

			try {
				aborter = await w.watch(
					path,
					queryParams,
					(type, obj) => {
						if (type === 'BOOKMARK') return;
						const e = obj as {
							type?: string;
							reason?: string;
							message?: string;
							count?: number;
							firstTimestamp?: string;
							lastTimestamp?: string;
							eventTime?: string;
							metadata?: { name?: string; namespace?: string };
							involvedObject?: { kind?: string; name?: string; namespace?: string };
						};
						emit({
							type,
							event: {
								type: e.type ?? '?',
								reason: e.reason ?? '?',
								message: e.message ?? '',
								count: e.count ?? 1,
								firstSeen: e.firstTimestamp ?? e.eventTime,
								lastSeen: e.lastTimestamp ?? e.eventTime,
								name: e.metadata?.name ?? '',
								namespace:
									e.metadata?.namespace ?? e.involvedObject?.namespace ?? '',
								involved: `${e.involvedObject?.kind ?? '?'}/${e.involvedObject?.name ?? '?'}`
							}
						});
					},
					(err) => {
						if (err && !closed) {
							emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
						}
					}
				);
			} catch (err) {
				emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
			}

			request.signal.addEventListener('abort', () => {
				closed = true;
				try {
					aborter?.abort();
				} catch {
					/* */
				}
				try {
					controller.close();
				} catch {
					/* */
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
