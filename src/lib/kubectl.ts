import { toast } from './toast.svelte';

// Generate kubectl command equivalents for the UI's "copy" buttons.
// Cluster name is included as a comment header so an operator with
// multiple kubeconfigs sees which cluster the command was generated
// for. We don't try to fabricate `--context=` because the local
// kubeconfig context name on the operator's laptop won't match the
// dashboard's cluster registry name.

export type KubectlVerb = 'get' | 'describe' | 'edit' | 'delete' | 'logs';

export type KubectlTarget = {
	cluster?: string;
	kind: string; // singular, e.g. "Pod", "Deployment", "ConfigMap"
	namespace?: string;
	name: string;
	container?: string; // for logs
};

function kindToCli(kind: string): string {
	// kubectl is case-insensitive but lowercase reads cleaner. Plural
	// forms also work; stick with singular to mirror our k8s data.
	return kind.toLowerCase();
}

export function buildKubectl(verb: KubectlVerb, t: KubectlTarget): string {
	const k = kindToCli(t.kind);
	const ns = t.namespace ? ` -n ${t.namespace}` : '';
	const header = t.cluster ? `# cluster: ${t.cluster}\n` : '';

	switch (verb) {
		case 'get':
			return `${header}kubectl get ${k} ${t.name}${ns} -o yaml`;
		case 'describe':
			return `${header}kubectl describe ${k} ${t.name}${ns}`;
		case 'edit':
			return `${header}kubectl edit ${k} ${t.name}${ns}`;
		case 'delete':
			return `${header}kubectl delete ${k} ${t.name}${ns}`;
		case 'logs': {
			const c = t.container ? ` -c ${t.container}` : '';
			return `${header}kubectl logs ${t.name}${ns}${c} --tail=200 -f`;
		}
	}
}

// One-shot: build + copy + toast. Returns true on success.
export async function copyKubectl(verb: KubectlVerb, t: KubectlTarget): Promise<boolean> {
	const cmd = buildKubectl(verb, t);
	try {
		await navigator.clipboard.writeText(cmd);
		toast.show(`Copied kubectl ${verb}`, 'ok');
		return true;
	} catch (err) {
		toast.show(`Clipboard failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
		return false;
	}
}
