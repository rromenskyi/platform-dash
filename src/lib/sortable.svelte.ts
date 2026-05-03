// Tiny per-table column-sort helper. Each list page hands in a map
// of `key → selector`, gets back a reactive sort state, a `compare`
// for `Array.prototype.sort`, a `toggle` for `<th onclick>`, and an
// `indicator` for the arrow glyph next to the active column.
//
// Per-page localStorage persistence is opt-in via `prefKey`. We
// write on every toggle (no $effect) so the helper stays usable from
// non-component callers and doesn't fight the page's own $effects.

type Dir = 'asc' | 'desc';

export type Sorter<T, K extends string> = {
	readonly key: K;
	readonly dir: Dir;
	compare: (a: T, b: T) => number;
	toggle: (k: K) => void;
	indicator: (k: K) => string;
};

export function createSort<T, K extends string>(opts: {
	keys: Record<K, (row: T) => unknown>;
	defaultKey: K;
	defaultDir?: Dir;
	prefKey?: string;
}): Sorter<T, K> {
	const defaultDir: Dir = opts.defaultDir ?? 'asc';

	let initKey: K = opts.defaultKey;
	let initDir: Dir = defaultDir;
	if (opts.prefKey && typeof localStorage !== 'undefined') {
		try {
			const raw = localStorage.getItem(opts.prefKey);
			if (raw) {
				const p = JSON.parse(raw) as { key?: string; dir?: string };
				if (p.key && p.key in opts.keys) initKey = p.key as K;
				if (p.dir === 'asc' || p.dir === 'desc') initDir = p.dir;
			}
		} catch {
			/* localStorage rejected or shape changed — ignore. */
		}
	}

	let key = $state<K>(initKey);
	let dir = $state<Dir>(initDir);

	function persist() {
		if (!opts.prefKey || typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(opts.prefKey, JSON.stringify({ key, dir }));
		} catch {
			/* */
		}
	}

	function compare(a: T, b: T): number {
		const sel = opts.keys[key];
		const va = sel(a);
		const vb = sel(b);
		let cmp = 0;
		if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
		else if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb);
		else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
		return dir === 'asc' ? cmp : -cmp;
	}

	function toggle(k: K) {
		if (key === k) {
			dir = dir === 'asc' ? 'desc' : 'asc';
		} else {
			key = k;
			dir = 'asc';
		}
		persist();
	}

	function indicator(k: K): string {
		if (k !== key) return '';
		return dir === 'asc' ? '↑' : '↓';
	}

	return {
		get key() {
			return key;
		},
		get dir() {
			return dir;
		},
		compare,
		toggle,
		indicator
	};
}
