// Reusable keyboard navigation for table-style list pages. Pages
// instantiate one per visible list and wire `focusedIdx` into row
// rendering + register/unregister inside `$effect`.
//
//   const nav = createKbdNav({
//     rowCount: () => filtered.length,
//     onEnter: (i) => goto(rowHref(filtered[i])),
//     onSelect: canWrite ? (i) => toggleSelected(filtered[i]) : undefined,
//   });
//   $effect(() => nav.attach());
//   <tr class:row-focused={i === nav.focusedIdx}>
//
// Skipped when the focus is in a text input / textarea / select /
// contenteditable so form keystrokes pass through unchanged. Modifier
// keys (cmd / ctrl / alt) also pass — they belong to the OS / browser.

export type KbdNavInit = {
	rowCount: () => number;
	onEnter?: (idx: number) => void;
	onSelect?: (idx: number) => void;
	onEscape?: () => boolean; // return true if handled (prevents default)
	searchSelector?: string;
};

export class KbdNav {
	focusedIdx = $state(-1);
	#init: KbdNavInit;

	constructor(init: KbdNavInit) {
		this.#init = init;
	}

	#shouldSkip(t: EventTarget | null): boolean {
		if (!(t instanceof HTMLElement)) return false;
		return (
			t instanceof HTMLInputElement ||
			t instanceof HTMLTextAreaElement ||
			t instanceof HTMLSelectElement ||
			t.isContentEditable
		);
	}

	#onKey = (e: KeyboardEvent) => {
		if (this.#shouldSkip(e.target)) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const max = this.#init.rowCount() - 1;
		switch (e.key) {
			case 'j':
				if (max < 0) return;
				this.focusedIdx = this.focusedIdx < 0 ? 0 : Math.min(max, this.focusedIdx + 1);
				e.preventDefault();
				return;
			case 'k':
				if (max < 0) return;
				this.focusedIdx = this.focusedIdx <= 0 ? 0 : this.focusedIdx - 1;
				e.preventDefault();
				return;
			case 'Enter':
				if (this.focusedIdx < 0 || this.focusedIdx > max) return;
				this.#init.onEnter?.(this.focusedIdx);
				e.preventDefault();
				return;
			case 'x':
				if (!this.#init.onSelect) return;
				if (this.focusedIdx < 0 || this.focusedIdx > max) return;
				this.#init.onSelect(this.focusedIdx);
				e.preventDefault();
				return;
			case 'Escape':
				if (this.#init.onEscape?.()) e.preventDefault();
				return;
			case '/': {
				const sel = this.#init.searchSelector ?? 'input.search';
				const search = document.querySelector<HTMLInputElement>(sel);
				if (search) {
					search.focus();
					e.preventDefault();
				}
				return;
			}
		}
	};

	attach(): () => void {
		window.addEventListener('keydown', this.#onKey);
		return () => window.removeEventListener('keydown', this.#onKey);
	}

	reset() {
		this.focusedIdx = -1;
	}
}

export function createKbdNav(init: KbdNavInit): KbdNav {
	return new KbdNav(init);
}
