import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { core } from '$lib/k8s.server';
import { time } from '$lib/k8s-metrics.server';

export const load: PageServerLoad = async (event) => {
	const { cluster, ns, name } = event.params;
	try {
		const cm = await time(`${cluster}/readNamespacedConfigMap`, () =>
			core(cluster).readNamespacedConfigMap({ name, namespace: ns })
		);
		return {
			cluster,
			ns,
			name,
			data: (cm.data ?? {}) as Record<string, string>,
			binaryDataKeys: Object.keys((cm.binaryData ?? {}) as Record<string, string>),
			creationTimestamp: cm.metadata?.creationTimestamp
				? new Date(cm.metadata.creationTimestamp).toISOString()
				: undefined,
			labels: (cm.metadata?.labels ?? {}) as Record<string, string>
		};
	} catch (err) {
		console.error('read configmap failed', err);
		const code =
			typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 404
				? 404
				: 500;
		throw error(code, `ConfigMap ${ns}/${name} not found`);
	}
};
