import { Watch } from '@kubernetes/client-node';
import { error } from '@sveltejs/kit';
import { canRead } from '$lib/authz';
import { isNamespaceName } from '$lib/k8s-names';
import { isKnownCluster, getKubeConfig } from '$lib/clusters.server';
import type { Session } from '@auth/core/types';

// Shared scaffolding for SSE-wrapping a k8s watch. List pages just
// pass the watch path + a row mapper; the helper handles auth, SSE
// formatting, abort plumbing, and error propagation. Kept off the
// shared k8s.server.ts surface because it's only consumed by the
// per-resource +server.ts files.

export type WatchSpec = {
	cluster: string;
	pathFor: (ns: string) => string;
	mapItem: (raw: unknown) => Record<string, unknown> | null;
};

export async function buildWatchResponse(
	specBuilder: (cluster: string, ns: string) => WatchSpec,
	{
		params,
		url,
		locals,
		request
	}: {
		params: { cluster: string };
		url: URL;
		locals: { auth: () => Promise<Session | null> };
		request: Request;
	}
): Promise<Response> {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);
	const ns = url.searchParams.get('ns') || '';
	// `ns` is interpolated into the raw watch path.
	if (ns && !isNamespaceName(ns)) throw error(400, 'invalid namespace');
	// Pass ns so namespace-scoped readers stream their own ns. A
	// missing ns falls back to a cluster-wide read role (global or
	// cluster_<x>_*); ns-only operators without ns get 403, since
	// streaming cluster-wide would cross their boundary.
	if (!canRead(session, cluster, ns || undefined)) {
		// ns-only operators must include `?ns=<their-ns>` — without it,
		// the stream would be cluster-wide and cross their boundary.
		throw error(403, 'read role required (cluster-wide or matching ?ns=)');
	}
	const spec = specBuilder(cluster, ns);
	const w = new Watch(getKubeConfig(cluster));
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
					spec.pathFor(ns),
					{},
					(type, obj) => {
						if (type === 'BOOKMARK') return;
						const item = spec.mapItem(obj);
						if (!item) return;
						emit({ type, item });
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
}
