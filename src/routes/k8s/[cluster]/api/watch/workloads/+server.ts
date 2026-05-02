import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { watcher } from '$lib/k8s.server';
import { isKnownCluster } from '$lib/clusters.server';
import { canRead } from '$lib/authz';

// SSE feed of pod / deployment / statefulset events. We open three
// parallel watches and fan their events into one stream so the
// workloads page only needs a single EventSource. Each event message
// carries enough metadata for the client to splice the row in place
// without re-running the page loader.
//
// Event shape on the wire:
//   {kind, type: ADDED|MODIFIED|DELETED, item: WorkloadRow}
// where WorkloadRow matches the same shape /workloads/+page.server.ts
// returns, so the client can hand them to the same renderer.

type ItemMin = {
	metadata?: {
		namespace?: string;
		name?: string;
		creationTimestamp?: string | Date;
		resourceVersion?: string;
	};
	status?: Record<string, unknown> & { phase?: string };
	spec?: Record<string, unknown>;
};

function podRow(p: ItemMin) {
	const containers =
		((p.status as { containerStatuses?: Array<{ ready?: boolean; restartCount?: number }> })
			.containerStatuses ?? []);
	const ready = containers.filter((c) => c.ready).length;
	const total =
		containers.length || ((p.spec as { containers?: unknown[] })?.containers?.length ?? 0);
	const restarts = containers.reduce((acc, c) => acc + (c.restartCount ?? 0), 0);
	return {
		namespace: p.metadata?.namespace ?? '?',
		name: p.metadata?.name ?? '?',
		kind: 'Pod',
		ready: `${ready}/${total}`,
		status: p.status?.phase ?? '?',
		restarts,
		creationTimestamp: p.metadata?.creationTimestamp
			? new Date(p.metadata.creationTimestamp).toISOString()
			: undefined,
		node: (p.spec as { nodeName?: string })?.nodeName
	};
}

function deployRow(d: ItemMin) {
	const total = (d.spec as { replicas?: number })?.replicas ?? 0;
	const ready = (d.status as { readyReplicas?: number })?.readyReplicas ?? 0;
	return {
		namespace: d.metadata?.namespace ?? '?',
		name: d.metadata?.name ?? '?',
		kind: 'Deployment',
		ready: `${ready}/${total}`,
		status: ready === total ? 'Ready' : 'Pending',
		restarts: 0,
		creationTimestamp: d.metadata?.creationTimestamp
			? new Date(d.metadata.creationTimestamp).toISOString()
			: undefined,
		node: undefined as string | undefined
	};
}

function ssRow(s: ItemMin) {
	const total = (s.spec as { replicas?: number })?.replicas ?? 0;
	const ready = (s.status as { readyReplicas?: number })?.readyReplicas ?? 0;
	return {
		namespace: s.metadata?.namespace ?? '?',
		name: s.metadata?.name ?? '?',
		kind: 'StatefulSet',
		ready: `${ready}/${total}`,
		status: ready === total ? 'Ready' : 'Pending',
		restarts: 0,
		creationTimestamp: s.metadata?.creationTimestamp
			? new Date(s.metadata.creationTimestamp).toISOString()
			: undefined,
		node: undefined as string | undefined
	};
}

export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	const session = await locals.auth();
	const { cluster } = params;
	if (!isKnownCluster(cluster)) throw error(404, `Unknown cluster "${cluster}"`);
	if (!canRead(session, cluster)) {
		throw error(403, 'platform_admin/sre or cluster_<name>_admin/sre role required');
	}
	const ns = url.searchParams.get('ns') || '';
	const w = watcher(cluster);
	const encoder = new TextEncoder();

	const podsPath = ns ? `/api/v1/namespaces/${ns}/pods` : `/api/v1/pods`;
	const depsPath = ns
		? `/apis/apps/v1/namespaces/${ns}/deployments`
		: `/apis/apps/v1/deployments`;
	const ssPath = ns
		? `/apis/apps/v1/namespaces/${ns}/statefulsets`
		: `/apis/apps/v1/statefulsets`;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const aborters: AbortController[] = [];
			let closed = false;
			function emit(payload: object) {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
				} catch {
					closed = true;
				}
			}
			function shutdown() {
				if (closed) return;
				closed = true;
				for (const a of aborters) {
					try {
						a.abort();
					} catch {
						/* */
					}
				}
				try {
					controller.close();
				} catch {
					/* */
				}
			}

			async function open(
				path: string,
				rowFn: (item: ItemMin) => ReturnType<typeof podRow>
			) {
				try {
					const ac = await w.watch(
						path,
						{},
						(type, obj) => {
							if (type === 'BOOKMARK') return;
							emit({ kind: rowFn(obj as ItemMin).kind, type, item: rowFn(obj as ItemMin) });
						},
						(err) => {
							if (err && !closed) {
								emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
							}
						}
					);
					aborters.push(ac);
				} catch (err) {
					emit({
						kind: 'error',
						message: `watch ${path} failed: ${err instanceof Error ? err.message : String(err)}`
					});
				}
			}

			await Promise.all([open(podsPath, podRow), open(depsPath, deployRow), open(ssPath, ssRow)]);

			request.signal.addEventListener('abort', shutdown);
		},
		cancel() {
			// ReadableStream cancel happens on client disconnect or
			// upstream abort; close the watches so we stop pulling deltas.
			// `aborters` is captured in start() — nothing to do here that
			// the request.signal handler hasn't already done.
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
