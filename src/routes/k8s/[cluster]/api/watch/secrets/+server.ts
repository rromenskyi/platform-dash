import type { RequestHandler } from './$types';
import { buildWatchResponse } from '$lib/sse-watch.server';

type ItemMin = {
	metadata?: { namespace?: string; name?: string; creationTimestamp?: string | Date };
	type?: string;
	data?: Record<string, string>;
};

export const GET: RequestHandler = async (event) =>
	buildWatchResponse(
		(_cluster) => ({
			cluster: _cluster,
			pathFor: (n) => (n ? `/api/v1/namespaces/${n}/secrets` : `/api/v1/secrets`),
			mapItem: (raw) => {
				const s = raw as ItemMin;
				return {
					namespace: s.metadata?.namespace ?? '?',
					name: s.metadata?.name ?? '?',
					type: s.type ?? 'Opaque',
					keys: Object.keys((s.data ?? {}) as Record<string, string>),
					creationTimestamp: s.metadata?.creationTimestamp
						? new Date(s.metadata.creationTimestamp).toISOString()
						: undefined
				};
			}
		}),
		event
	);
