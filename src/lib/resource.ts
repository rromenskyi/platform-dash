// Tree node contract for the sidebar resource browser. Per-family
// surfaces (k8s, future storage / vps / image / ...) keep their own
// route trees and data loaders, but every family exposes its tree of
// browsable nodes through this same shape so the sidebar can render
// them uniformly.
//
// Path C from the architecture decision (see project_roadmap.md):
// per-family routes for the deep pages, one shared graph for the
// nav. Each leaf links into its family's URL.

export type ResourceNode = {
	// Stable id within the family — used as React-style key in the
	// renderer; doesn't have to be globally unique because the family
	// prefix in the parent path disambiguates.
	id: string;
	// Visible label.
	label: string;
	// Optional small badge / count surfaced next to the label, e.g.
	// "12" pods. Tree consumers must handle undefined.
	hint?: string;
	// Where clicking the node lands the user. Required for leaves;
	// optional for groups (clicking a group just toggles open state).
	href?: string;
	// Children — a function so the tree can lazy-fetch deep nodes
	// (per-namespace pod list etc.) without the parent loader having
	// to walk everything up front. Empty array = leaf with no
	// children. Undefined = "expandable, content not yet known".
	children?: () => ResourceNode[] | Promise<ResourceNode[]>;
	// Free-form: families tag their nodes (e.g. {family: "k8s",
	// kind: "Pod"}) so the renderer can switch icons / colours.
	meta?: Record<string, unknown>;
};

// Top-level entry point: returns each registered family's root node.
// Families register here as more resource types come online; for now
// only k8s exists, served from /lib/resource-tree-k8s.server.ts.
export type ResourceTreeProvider = () => Promise<ResourceNode[]>;

// JSON-safe projection of the tree — drops the children function and
// inlines its eager result. Used to ship the sidebar tree from the
// root layout loader to the client. Async-children families would
// need to materialise their own deep results before this serialises.
export type SerializableNode = {
	id: string;
	label: string;
	hint?: string;
	href?: string;
	children: SerializableNode[];
	meta?: Record<string, unknown>;
};

export async function materialize(nodes: ResourceNode[]): Promise<SerializableNode[]> {
	const out: SerializableNode[] = [];
	for (const n of nodes) {
		const kids = n.children ? await n.children() : [];
		out.push({
			id: n.id,
			label: n.label,
			hint: n.hint,
			href: n.href,
			children: await materialize(kids),
			meta: n.meta
		});
	}
	return out;
}
