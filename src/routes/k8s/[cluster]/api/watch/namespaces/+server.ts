import type { RequestHandler } from './$types';
import { buildWatchResponse } from '$lib/sse-watch.server';

type ItemMin = {
	metadata?: { name?: string; creationTimestamp?: string | Date; labels?: Record<string, string> };
	status?: { phase?: string };
};

// Namespaces are cluster-scoped — the global ?ns= filter doesn't
// apply, so we always use the cluster-wide path.
export const GET: RequestHandler = async (event) =>
	buildWatchResponse(
		(_cluster) => ({
			cluster: _cluster,
			pathFor: () => `/api/v1/namespaces`,
			mapItem: (raw) => {
				const n = raw as ItemMin;
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
