// Reactive client state for a Live-toggleable list backed by an SSE
// watch endpoint. List pages instantiate one of these and read
// `.rows` / `.error` / `.live`. Reconciliation happens against a
// keyed Map so deltas splice in place without re-rendering rows that
// didn't change.
//
// Each LiveList registers with the global live-registry so navigation
// (ns/cluster selector, saved views, sidebar links) can close all
// active streams before goto — without that, the SSE holds an
// HTTP/1.1 slot the load fetch needs.
//
// Usage in a Svelte 5 component (.svelte file):
//   const live = createLiveList<Row>({
//     initial: data.rows,
//     url: () => `/k8s/${data.cluster}/api/watch/configmaps?ns=${ns}`,
//     keyFn: (r) => `${r.namespace}|${r.name}`,
//     sortFn: byNsName,
//   });
//   ... bind:checked={live.live}, use {#each live.rows as r}

import { registerLive, unregisterLive } from './live-registry.svelte';

export type LiveListInit<T> = {
	initial: T[];
	url: () => string;
	keyFn: (row: T) => string;
	sortFn?: (a: T, b: T) => number;
};

type Msg<T> =
	| { type: 'ADDED' | 'MODIFIED'; item: T }
	| { type: 'DELETED'; item: T }
	| { type: 'error'; message: string };

export class LiveList<T> {
	rows = $state<T[]>([]);
	error = $state<string | null>(null);
	live = $state(false);

	#map = new Map<string, T>();
	#es: EventSource | null = null;
	#init: LiveListInit<T>;

	constructor(init: LiveListInit<T>) {
		this.#init = init;
		this.rows = init.initial;
	}

	// Re-seed the Map from the loader's snapshot. Call from a $effect
	// in the page when `data.rows` changes (cluster / ns navigation).
	reseed(rows: T[]) {
		this.rows = rows;
		this.#map = new Map(rows.map((r) => [this.#init.keyFn(r), r]));
	}

	#rebuild() {
		const arr = Array.from(this.#map.values());
		if (this.#init.sortFn) arr.sort(this.#init.sortFn);
		this.rows = arr;
	}

	#regKey(): string {
		return `live-list:${this.#init.url()}`;
	}

	#open() {
		this.#close();
		this.reseed(this.rows);
		this.error = null;
		const es = new EventSource(this.#init.url());
		this.#es = es;
		// Singleton policy via the registry — any other live stream
		// (other tab on this page, a stray pod-events stream, etc) is
		// closed first so we don't sit on multiple HTTP slots.
		registerLive(this.#regKey(), () => {
			es.close();
			if (this.#es === es) this.#es = null;
			// Also flip the bound flag so the UI checkbox reflects reality.
			this.live = false;
		});
		es.onmessage = (ev) => {
			try {
				const msg = JSON.parse(ev.data) as Msg<T>;
				if (msg.type === 'error') {
					this.error = msg.message;
					return;
				}
				const k = this.#init.keyFn(msg.item);
				if (msg.type === 'DELETED') this.#map.delete(k);
				else this.#map.set(k, msg.item);
				this.#rebuild();
			} catch {
				/* malformed event */
			}
		};
	}

	#close() {
		if (this.#es) {
			unregisterLive(this.#regKey());
			this.#es = null;
		}
	}

	// Drive open/close from outside. Page wires this into a $effect
	// that also tracks any URL params the watch URL depends on so a
	// ns / cluster switch reconnects automatically.
	sync() {
		if (this.live) this.#open();
		else this.#close();
	}

	destroy() {
		this.#close();
	}
}

export function createLiveList<T>(init: LiveListInit<T>): LiveList<T> {
	return new LiveList<T>(init);
}
