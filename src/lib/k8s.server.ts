import {
	CoreV1Api,
	AppsV1Api,
	BatchV1Api,
	NetworkingV1Api,
	ApiextensionsV1Api,
	CustomObjectsApi,
	Log,
	Watch,
	Metrics
} from '@kubernetes/client-node';
import { getKubeConfig } from './clusters.server';

// Server-only: `@kubernetes/client-node` pulls in `node:fs`, `node:http2`,
// etc. which Vite cannot resolve for the browser bundle. The `.server.ts`
// suffix tells SvelteKit to hard-fail any attempt to import this from
// client code, instead of silently shipping it and crashing on hydrate
// with `Class extends value undefined is not a constructor`.
//
// Each factory takes a cluster name; the underlying KubeConfig is
// resolved + cached in `clusters.server.ts`. Single-cluster deployments
// pass the literal "local" (or use the default cluster name surfaced
// by `defaultCluster()`).
export const core = (cluster: string): CoreV1Api =>
	getKubeConfig(cluster).makeApiClient(CoreV1Api);
export const apps = (cluster: string): AppsV1Api =>
	getKubeConfig(cluster).makeApiClient(AppsV1Api);
export const batch = (cluster: string): BatchV1Api =>
	getKubeConfig(cluster).makeApiClient(BatchV1Api);
export const networking = (cluster: string): NetworkingV1Api =>
	getKubeConfig(cluster).makeApiClient(NetworkingV1Api);
export const apiextensions = (cluster: string): ApiextensionsV1Api =>
	getKubeConfig(cluster).makeApiClient(ApiextensionsV1Api);
export const customObjects = (cluster: string): CustomObjectsApi =>
	getKubeConfig(cluster).makeApiClient(CustomObjectsApi);
// `Log` isn't a generated API client — it's a thin wrapper around the
// raw HTTP log endpoint that pipes the response into a Writable. We
// expose it as a factory for symmetry with the other k8s clients.
export const logger = (cluster: string): Log => new Log(getKubeConfig(cluster));
// `Watch` opens a long-lived ?watch=1 connection to any list endpoint
// and fires a callback per event. Callers thread the events into an
// SSE response back to the browser.
export const watcher = (cluster: string): Watch => new Watch(getKubeConfig(cluster));
// `Metrics` queries metrics.k8s.io (metrics-server) for pod / node
// CPU + memory usage. Optional dep — clusters without metrics-server
// installed return 404; callers must catch.
export const metrics = (cluster: string): Metrics => new Metrics(getKubeConfig(cluster));

// Unwraps an @kubernetes/client-node ApiException into something fit
// for a toast. The SDK packs the full HTTP dump into err.message
// ("HTTP-Code: ...\nMessage: ...\nBody: <stringified V1Status>\n
// Headers: ..."), so handlers must reach for err.body to get the
// apiserver's V1Status.message. err.body may already be parsed or
// still a JSON string depending on response content-type.
export function kubeError(err: unknown): { code: number; message: string } {
	const e = err as {
		code?: number;
		body?: { message?: string; reason?: string } | string;
		message?: string;
	};
	const code = typeof e.code === 'number' ? e.code : 500;
	let body: { message?: string; reason?: string } | undefined;
	if (typeof e.body === 'string') {
		try {
			body = JSON.parse(e.body);
		} catch {
			body = { message: e.body };
		}
	} else if (e.body && typeof e.body === 'object') {
		body = e.body;
	}
	const message = body?.message ?? body?.reason ?? e.message ?? String(err);
	return { code, message };
}
