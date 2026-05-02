// Tiny toast queue. Single global instance, mounted once in the root
// layout. Components anywhere call `toast.show(msg, kind?)` and the
// notification appears in the corner — no prop drilling.
//
// Auto-dismiss timing varies by kind:
//   ok   — 3s
//   warn — 6s
//   err  — never; operator closes manually so they have time to
//          read + copy the error text. Sticky errors can pile up
//          but are capped at MAX visible.
//
// Capped at 5 visible at a time to prevent runaway action-spam from
// drowning the screen during incidents.

export type ToastKind = 'ok' | 'warn' | 'err';
export type ToastItem = { id: number; msg: string; kind: ToastKind };

const MAX = 5;
const DISMISS_MS: Record<ToastKind, number | null> = {
	ok: 3000,
	warn: 6000,
	err: null
};

class ToastBus {
	items = $state<ToastItem[]>([]);
	#nextId = 1;

	show(msg: string, kind: ToastKind = 'ok'): number {
		const id = this.#nextId++;
		const next = [...this.items, { id, msg, kind }];
		this.items = next.length > MAX ? next.slice(next.length - MAX) : next;
		const ms = DISMISS_MS[kind];
		if (ms !== null) {
			setTimeout(() => this.dismiss(id), ms);
		}
		return id;
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}

	clear(): void {
		this.items = [];
	}
}

export const toast = new ToastBus();
