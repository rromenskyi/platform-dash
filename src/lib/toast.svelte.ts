// Tiny toast queue. Single global instance, mounted once in the root
// layout. Components anywhere call `toast.show(msg, kind?)` and the
// notification appears in the corner — no prop drilling.
//
// Auto-dismiss in 3s; user can dismiss earlier by clicking. Capped
// at 5 visible at a time to prevent runaway action-spam from drowning
// the screen during incidents.

export type ToastKind = 'ok' | 'warn' | 'err';
export type ToastItem = { id: number; msg: string; kind: ToastKind };

const MAX = 5;
const DISMISS_MS = 3000;

class ToastBus {
	items = $state<ToastItem[]>([]);
	#nextId = 1;

	show(msg: string, kind: ToastKind = 'ok'): number {
		const id = this.#nextId++;
		const next = [...this.items, { id, msg, kind }];
		this.items = next.length > MAX ? next.slice(next.length - MAX) : next;
		setTimeout(() => this.dismiss(id), DISMISS_MS);
		return id;
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toast = new ToastBus();
