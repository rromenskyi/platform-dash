import { KubeConfig } from '@kubernetes/client-node';
import { env } from '$env/dynamic/private';

// Cluster registry. Each named cluster gets its own KubeConfig — the
// in-cluster pod we run in is "local" by default; remote clusters
// load a kubeconfig file mounted into the pod (typically from a
// Kubernetes Secret).
//
// Configuration via env DASH_CLUSTERS_JSON, e.g.:
//   [{"name":"home","inCluster":true},
//    {"name":"office","kubeconfigPath":"/etc/clusters/office.yaml"},
//    {"name":"office","kubeconfigPath":"/etc/clusters/office.yaml","kubeconfigContext":"office-prod"}]
//
// Defaults to a single in-cluster entry called "local" so existing
// single-cluster deployments keep working without any new env vars.
export type ClusterConfig = {
	name: string;
	inCluster?: boolean;
	kubeconfigPath?: string;
	// When the kubeconfig file holds multiple contexts, pick one. Falls
	// back to the file's current-context if unset.
	kubeconfigContext?: string;
};

function loadConfigs(): ClusterConfig[] {
	const raw = env.DASH_CLUSTERS_JSON;
	if (!raw) return [{ name: 'local', inCluster: true }];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed) || parsed.length === 0) {
			console.warn('DASH_CLUSTERS_JSON is empty/invalid, falling back to in-cluster only');
			return [{ name: 'local', inCluster: true }];
		}
		// Normalise + dedupe by name (last definition wins).
		const out = new Map<string, ClusterConfig>();
		for (const c of parsed as ClusterConfig[]) {
			if (!c?.name) continue;
			out.set(c.name, c);
		}
		const arr = Array.from(out.values());
		return arr.length ? arr : [{ name: 'local', inCluster: true }];
	} catch (err) {
		console.error('failed to parse DASH_CLUSTERS_JSON, falling back to in-cluster only', err);
		return [{ name: 'local', inCluster: true }];
	}
}

const configs = loadConfigs();

// One KubeConfig per cluster, lazily built and cached. The k8s SDK
// holds onto an HTTP/2 connection per client so reusing the config
// across requests matters.
const kcCache = new Map<string, KubeConfig>();

function buildKubeConfig(cfg: ClusterConfig): KubeConfig {
	const kc = new KubeConfig();
	if (cfg.inCluster) {
		try {
			kc.loadFromCluster();
		} catch (err) {
			console.warn(`cluster "${cfg.name}" inCluster load failed, falling back to default`, err);
			kc.loadFromDefault();
		}
	} else if (cfg.kubeconfigPath) {
		kc.loadFromFile(cfg.kubeconfigPath);
		if (cfg.kubeconfigContext) kc.setCurrentContext(cfg.kubeconfigContext);
	} else {
		// Last resort — use whatever the process can find. Helpful for
		// local dev where the developer just has ~/.kube/config.
		kc.loadFromDefault();
	}
	return kc;
}

export function listClusters(): string[] {
	return configs.map((c) => c.name);
}

export function isKnownCluster(name: string): boolean {
	return configs.some((c) => c.name === name);
}

export function defaultCluster(): string {
	return configs[0].name;
}

export function getKubeConfig(name: string): KubeConfig {
	const cached = kcCache.get(name);
	if (cached) return cached;
	const cfg = configs.find((c) => c.name === name);
	if (!cfg) throw new Error(`unknown cluster: ${name}`);
	const kc = buildKubeConfig(cfg);
	kcCache.set(name, kc);
	return kc;
}
