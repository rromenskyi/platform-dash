import type { ResourceNode } from './resource';
import { listTargets } from './db-targets.server';

// DB family resource tree. Top level groups by kind (Postgres /
// Redis); leaves are individual targets that link into the per-target
// detail page. Cluster is just shown as a hint when present (cloud
// DBs leave it blank).
export function buildDbTree(): ResourceNode[] {
	const targets = listTargets();
	if (targets.length === 0) return [];

	const byKind = new Map<string, typeof targets>();
	for (const t of targets) {
		const arr = byKind.get(t.kind);
		if (arr) arr.push(t);
		else byKind.set(t.kind, [t]);
	}

	const groups: ResourceNode[] = [];
	for (const kind of ['postgres', 'redis']) {
		const items = byKind.get(kind);
		if (!items || items.length === 0) continue;
		groups.push({
			id: `db/${kind}`,
			label: kind === 'postgres' ? 'Postgres' : 'Redis',
			meta: { family: 'db', kind },
			children: () =>
				items.map((t) => ({
					id: `db/${kind}/${t.name}`,
					label: t.label ?? t.name,
					hint: t.cluster,
					href: `/db/${t.name}`,
					meta: { family: 'db', kind, target: t.name }
				}))
		});
	}
	return groups;
}
