import { KubeConfig, CoreV1Api, AppsV1Api, BatchV1Api } from '@kubernetes/client-node';

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

// Tiny human-friendly age-since helper. The k8s API surfaces every
// timestamp as ISO 8601, but operators read "3d", "12m" faster than
// raw RFC strings. Inputs may be Date | string | undefined; missing
// values fall through to "—" so the UI never explodes on a partial
// fixture.
export function age(ts: Date | string | undefined): string {
	if (!ts) return '—';
	const t = typeof ts === 'string' ? new Date(ts) : ts;
	const sec = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 48) return `${hr}h`;
	const d = Math.floor(hr / 24);
	return `${d}d`;
}
