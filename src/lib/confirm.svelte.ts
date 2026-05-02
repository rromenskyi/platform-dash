// Promise-based confirmation dialog. Native `confirm()` is fine but
// blocks the renderer, can't be styled, and on macOS dialogs you
// can't tab between buttons reliably. This bus + <ConfirmDialog/>
// component (mounted once in the root layout) replaces it with a
// themed overlay that returns a Promise<boolean>.
//
// Usage:
//   const ok = await confirm({
//     title: 'Delete pod?',
//     body: `${ns}/${name} will be evicted. Controller respawns it if it has one.`,
//     confirm: 'Delete',
//     danger: true,
//   });
//   if (!ok) return;

export type ConfirmOpts = {
	title: string;
	body?: string;
	confirm?: string;
	cancel?: string;
	danger?: boolean;
};

type Pending = ConfirmOpts & { resolve: (ok: boolean) => void };

class ConfirmBus {
	pending = $state<Pending | null>(null);

	open(opts: ConfirmOpts): Promise<boolean> {
		// If something is already open, resolve it as cancelled — only
		// one dialog at a time. Operator clicking through fast won't
		// pile up zombie promises.
		if (this.pending) this.pending.resolve(false);
		return new Promise<boolean>((resolve) => {
			this.pending = { ...opts, resolve };
		});
	}

	resolve(ok: boolean): void {
		if (!this.pending) return;
		const r = this.pending.resolve;
		this.pending = null;
		r(ok);
	}
}

export const confirmBus = new ConfirmBus();

export function confirm(opts: ConfirmOpts): Promise<boolean> {
	return confirmBus.open(opts);
}
