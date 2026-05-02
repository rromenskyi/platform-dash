import type { ResourceNode } from './resource';
import { listClusters } from './clusters.server';

// k8s family resource tree. Top level = each configured cluster;
// each cluster expands into its k8s sub-sections (Workloads, Nodes,
// CRDs, Monitoring) that mirror the existing /k8s/[cluster]/* routes.
//
// Per-namespace expansion is intentionally NOT done here yet — the
// global namespace selector already covers that UX. When it makes
// sense to surface "ns -> resource" deeply (e.g. for a graph view),
// add another level here without changing the contract.
export function buildK8sTree(): ResourceNode[] {
	return listClusters().map((cluster) => ({
		id: `k8s/${cluster}`,
		label: cluster,
		href: `/k8s/${cluster}`,
		meta: { family: 'k8s', kind: 'Cluster' },
		children: () => [
			{
				id: `k8s/${cluster}/workloads`,
				label: 'Workloads',
				href: `/k8s/${cluster}/workloads`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/nodes`,
				label: 'Nodes',
				href: `/k8s/${cluster}/nodes`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/namespaces`,
				label: 'Namespaces',
				href: `/k8s/${cluster}/namespaces`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/services`,
				label: 'Services',
				href: `/k8s/${cluster}/services`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/ingresses`,
				label: 'Ingresses',
				href: `/k8s/${cluster}/ingresses`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/configmaps`,
				label: 'ConfigMaps',
				href: `/k8s/${cluster}/configmaps`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/secrets`,
				label: 'Secrets',
				href: `/k8s/${cluster}/secrets`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/jobs`,
				label: 'Jobs',
				href: `/k8s/${cluster}/jobs`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/cronjobs`,
				label: 'CronJobs',
				href: `/k8s/${cluster}/cronjobs`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/crds`,
				label: 'CRDs',
				href: `/k8s/${cluster}/crds`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/events`,
				label: 'Events',
				href: `/k8s/${cluster}/events`,
				meta: { family: 'k8s' }
			},
			{
				id: `k8s/${cluster}/monitoring`,
				label: 'Monitoring',
				href: `/k8s/${cluster}/monitoring`,
				meta: { family: 'k8s' }
			}
		]
	}));
}

// Top-level: k8s family + db family. New families append here.
import { buildDbTree } from './resource-tree-db.server';
export function buildAllTrees(): ResourceNode[] {
	const dbChildren = buildDbTree();
	const trees: ResourceNode[] = [
		{
			id: 'k8s',
			label: 'k8s',
			meta: { family: 'k8s' },
			children: () => buildK8sTree()
		}
	];
	if (dbChildren.length > 0) {
		trees.push({
			id: 'db',
			label: 'db',
			meta: { family: 'db' },
			children: () => dbChildren
		});
	}
	return trees;
}
