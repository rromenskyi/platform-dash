import type { RequestHandler } from './$types';
import { buildWatchResponse } from '$lib/sse-watch.server';

type ItemMin = {
	metadata?: { namespace?: string; name?: string; creationTimestamp?: string | Date };
	data?: Record<string, string>;
};

export const GET: RequestHandler = async (event) =>
	buildWatchResponse(
		(_cluster, ns) => ({
			cluster: _cluster,
			pathFor: (n) => (n ? `/api/v1/namespaces/${n}/configmaps` : `/api/v1/configmaps`),
			mapItem: (raw): Record<string, unknown> | null => {
				const cm = raw as ItemMin;
				return {
					namespace: cm.metadata?.namespace ?? '?',
					name: cm.metadata?.name ?? '?',
					keys: Object.keys((cm.data ?? {}) as Record<string, string>),
					creationTimestamp: cm.metadata?.creationTimestamp
						? new Date(cm.metadata.creationTimestamp).toISOString()
						: undefined
				};
			}
		}),
		event
	);
