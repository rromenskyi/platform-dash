import type { RequestHandler } from './$types';
import { buildWatchResponse } from '$lib/sse-watch.server';

type ItemMin = {
	metadata?: { name?: string; creationTimestamp?: string | Date; labels?: Record<string, string> };
	status?: { phase?: string };
};

// Namespaces are cluster-scoped, so we always watch the cluster-wide
// path. buildWatchResponse authorizes ?ns= against a namespace role,
// so when it's set only that one namespace may be emitted — otherwise
// an ns-only operator would stream every namespace in the cluster.
export const GET: RequestHandler = async (event) =>
	buildWatchResponse(
		(_cluster, ns) => ({
			cluster: _cluster,
			pathFor: () => `/api/v1/namespaces`,
			mapItem: (raw) => {
				const n = raw as ItemMin;
				if (ns && n.metadata?.name !== ns) return null;
				return {
					name: n.metadata?.name ?? '?',
					phase: n.status?.phase ?? '?',
					labels: (n.metadata?.labels ?? {}) as Record<string, string>,
					creationTimestamp: n.metadata?.creationTimestamp
						? new Date(n.metadata.creationTimestamp).toISOString()
						: undefined
				};
			}
		}),
		event
	);
