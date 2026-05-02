import { goto } from '$app/navigation';

// Make a whole `<tr>` clickable — but skip when the click landed on an
// interactive descendant (link, button, input, label, select). Without
// this guard, clicking a KubectlMenu chip / row checkbox / kill button
// would also navigate, which is a foot-gun.
//
// Modifier-aware too: ⌘/Ctrl-click delegates to the browser's open-in-
// new-tab behaviour by skipping the goto and letting any existing
// `<a>` inside the row handle it; if no link, we open in a new tab.

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'LABEL', 'SELECT', 'TEXTAREA']);

export function rowClick(href: string) {
	return (e: MouseEvent) => {
		// Walk the composed path from the click target up to the row.
		// Anything interactive in between owns the click — don't navigate.
		const path = e.composedPath();
		const row = e.currentTarget as HTMLElement;
		for (const el of path) {
			if (el === row) break;
			if (el instanceof HTMLElement) {
				if (INTERACTIVE_TAGS.has(el.tagName)) return;
				if (el.isContentEditable) return;
			}
		}
		// ⌘ / Ctrl / middle button → new tab.
		if (e.metaKey || e.ctrlKey || e.button === 1) {
			window.open(href, '_blank', 'noopener');
			return;
		}
		goto(href);
	};
}
