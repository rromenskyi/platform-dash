import {
	KubeConfig,
	CoreV1Api,
	AppsV1Api,
	BatchV1Api,
	ApiextensionsV1Api,
	CustomObjectsApi
} from '@kubernetes/client-node';

// Server-only: `@kubernetes/client-node` pulls in `node:fs`, `node:http2`,
// etc. which Vite cannot resolve for the browser bundle. The `.server.ts`
// suffix tells SvelteKit to hard-fail any attempt to import this from
// client code, instead of silently shipping it and crashing on hydrate
// with `Class extends value undefined is not a constructor`.
//
// Single in-cluster KubeConfig — picks up the SA token + cert from
// /var/run/secrets/kubernetes.io/serviceaccount/. The pod's SA is
// `platform-dash` with the cluster RBAC declared in the platform repo
// (modules/component → cluster_role_rules).
let kc: KubeConfig | null = null;

function getKubeConfig(): KubeConfig {
	if (kc) return kc;
	kc = new KubeConfig();
	try {
		kc.loadFromCluster();
	} catch (err) {
		// Local dev fallback — uses ~/.kube/config when running outside k8s.
		// Production pods always hit the cluster branch above.
		console.warn('k8s: in-cluster load failed, falling back to default kubeconfig', err);
		kc.loadFromDefault();
	}
	return kc;
}

export const core = (): CoreV1Api => getKubeConfig().makeApiClient(CoreV1Api);
export const apps = (): AppsV1Api => getKubeConfig().makeApiClient(AppsV1Api);
export const batch = (): BatchV1Api => getKubeConfig().makeApiClient(BatchV1Api);
export const apiextensions = (): ApiextensionsV1Api =>
	getKubeConfig().makeApiClient(ApiextensionsV1Api);
export const customObjects = (): CustomObjectsApi =>
	getKubeConfig().makeApiClient(CustomObjectsApi);
