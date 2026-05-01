// Per-user saved views, persisted to localStorage. Each view is just
// the URL slice — pathname + search — plus a name and a timestamp.
// No server roundtrip; views are personal to the browser. Sync across
// devices is a later concern.

const STORAGE_KEY = 'platform-dash:saved-views:v1';
const MAX = 50;

export type SavedView = {
	id: string; // generated, opaque
	name: string;
	path: string; // pathname
	search: string; // includes leading '?'
	addedAt: number;
};

function load(): SavedView[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.slice(0, MAX).filter((v) => v && v.id && v.name && v.path);
	} catch {
		return [];
	}
}

function persist(items: SavedView[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
	} catch {
		// Storage may be disabled or full — silent; the in-memory state
		// still works for the current tab session.
	}
}

class SavedViewsStore {
	items = $state<SavedView[]>([]);

	constructor() {
		// Constructor runs in browser (caller imports from a .svelte
		// component); SSR pages don't import this directly.
		if (typeof window !== 'undefined') {
			this.items = load();
			window.addEventListener('storage', (ev) => {
				if (ev.key !== STORAGE_KEY) return;
				this.items = load();
			});
		}
	}

	add(name: string, path: string, search: string): SavedView {
		const trimmed = name.trim() || path;
		// Replace any existing view with the same name to keep the list
		// from growing during quick re-saves of the same view.
		const filtered = this.items.filter((v) => v.name !== trimmed);
		const view: SavedView = {
			id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			name: trimmed,
			path,
			search,
			addedAt: Date.now()
		};
		const next = [view, ...filtered].slice(0, MAX);
		this.items = next;
		persist(next);
		return view;
	}

	remove(id: string): void {
		const next = this.items.filter((v) => v.id !== id);
		this.items = next;
		persist(next);
	}

	href(view: SavedView): string {
		return `${view.path}${view.search}`;
	}
}

export const savedViews = new SavedViewsStore();
