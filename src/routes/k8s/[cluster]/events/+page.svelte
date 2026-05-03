<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { registerLive, unregisterLive } from '$lib/live-registry.svelte';
	import { toast } from '$lib/toast.svelte';
	import LiveDot from '$lib/LiveDot.svelte';
	import type { LiveStreamState } from '$lib/live-list.svelte';
	import { createKbdNav } from '$lib/kbd-nav.svelte';
	import Highlight from '$lib/Highlight.svelte';
	import type { EventRow } from './+page.server';
	import { createSort } from '$lib/sortable.svelte';

	let { data } = $props();

	const PREF_KEY = 'platform-dash:events:v1';
	type Prefs = {
		q: string;
		typeFilter: 'all' | 'Normal' | 'Warning';
		rangeFilter: 'all' | '5m' | '1h' | '24h';
	};
	const initial: Prefs = (() => {
		const def: Prefs = { q: '', typeFilter: 'all', rangeFilter: 'all' };
		if (typeof localStorage === 'undefined') return def;
		try {
			const raw = localStorage.getItem(PREF_KEY);
			if (!raw) return def;
			const p = JSON.parse(raw) as Partial<Prefs>;
			return {
				q: p.q ?? def.q,
				typeFilter: p.typeFilter ?? def.typeFilter,
				rangeFilter: p.rangeFilter ?? def.rangeFilter
			};
		} catch {
			return def;
		}
	})();
	let q = $state(initial.q);
	let typeFilter = $state<Prefs['typeFilter']>(initial.typeFilter);
	let rangeFilter = $state<Prefs['rangeFilter']>(initial.rangeFilter);
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(PREF_KEY, JSON.stringify({ q, typeFilter, rangeFilter } satisfies Prefs));
		} catch {
			/* */
		}
	});
	let live = $state(false);
	let streamState = $state<LiveStreamState>('idle');
	let rows = $state<EventRow[]>([]);
	// `now` ticks every 5s so the range cutoff slides forward in
	// real time. Cheap — one assignment per tick.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 5_000);
		return () => clearInterval(t);
	});

	$effect(() => {
		// Reset on loader fire (different cluster / ns).
		rows = data.rows;
	});

	let es: EventSource | null = null;
	function regKey(): string {
		const ns = page.url.searchParams.get('ns') || '';
		return `cluster-events:${data.cluster}/${ns}`;
	}

	function startLive() {
		if (es) return;
		streamState = 'connecting';
		const u = new URL(`/k8s/${data.cluster}/api/watch/events`, window.location.origin);
		const ns = page.url.searchParams.get('ns') || '';
		if (ns) u.searchParams.set('ns', ns);
		const src = new EventSource(u.toString());
		es = src;
		registerLive(regKey(), () => {
			src.close();
			if (es === src) es = null;
			streamState = 'closed';
			live = false;
		});
		src.onopen = () => {
			if (es === src) streamState = 'open';
		};
		src.onmessage = (ev) => {
			if (es === src) streamState = 'open';
			try {
				const msg = JSON.parse(ev.data);
				if (msg.type === 'error') {
					toast.show(msg.message, 'err');
					return;
				}
				const e = msg.event as EventRow;
				// Dedup by (involved + reason + message); upsert otherwise.
				const idx = rows.findIndex(
					(x) => x.involved === e.involved && x.reason === e.reason && x.message === e.message
				);
				if (msg.type === 'DELETED') {
					if (idx >= 0) rows = [...rows.slice(0, idx), ...rows.slice(idx + 1)];
				} else if (idx >= 0) {
					rows = [...rows.slice(0, idx), { ...rows[idx], ...e }, ...rows.slice(idx + 1)];
				} else {
					rows = [e, ...rows];
				}
				rows.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
				if (rows.length > 500) rows = rows.slice(0, 500);
			} catch {
				/* malformed event */
			}
		};
		src.onerror = () => {
			if (es !== src) return;
			streamState = src.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting';
		};
	}
	function stopLive() {
		if (es) {
			unregisterLive(regKey());
			es = null;
		}
		streamState = 'idle';
	}
	$effect(() => {
		const _ns = page.url.searchParams.get('ns');
		void _ns;
		const isLive = live;
		stopLive();
		if (isLive) startLive();
	});
	onDestroy(stopLive);

	const rangeCutoffMs = $derived(
		rangeFilter === '5m'
			? 5 * 60_000
			: rangeFilter === '1h'
				? 60 * 60_000
				: rangeFilter === '24h'
					? 24 * 60 * 60_000
					: null
	);

	const sort = createSort<EventRow, 'type' | 'namespace' | 'involved' | 'reason' | 'count' | 'lastSeen'>({
		keys: {
			type: (e) => e.type,
			namespace: (e) => e.namespace,
			involved: (e) => e.involved,
			reason: (e) => e.reason,
			count: (e) => e.count,
			lastSeen: (e) => Date.parse(e.lastSeen ?? '') || 0
		},
		defaultKey: 'lastSeen',
		defaultDir: 'desc',
		prefKey: 'platform-dash:events:sort:v1'
	});

	const filtered = $derived(
		rows
			.filter((e) => {
				if (typeFilter !== 'all' && e.type !== typeFilter) return false;
				if (rangeCutoffMs != null) {
					const ts = Date.parse(e.lastSeen ?? '');
					if (!Number.isFinite(ts) || now - ts > rangeCutoffMs) return false;
				}
				if (!q) return true;
				const needle = q.toLowerCase();
				const hay = `${e.namespace} ${e.involved} ${e.reason} ${e.message}`.toLowerCase();
				return hay.includes(needle);
			})
			.slice()
			.sort(sort.compare)
	);

	const kbd = createKbdNav({ rowCount: () => filtered.length });
	$effect(() => kbd.attach());
</script>

<div class="header">
	<h1>Events</h1>
	<div class="head-actions">
		<label class="live-toggle">
			<input type="checkbox" bind:checked={live} /><LiveDot state={streamState} /> Live
		</label>
		<button class="ghost" onclick={() => invalidateAll()} disabled={live}>↻ Refresh</button>
	</div>
</div>

{#if data.error}<p class="error">Failed to list events: {data.error}</p>{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by ns / object / reason / message…" />
	<div class="kinds">
		{#each ['all', 'Normal', 'Warning'] as t}
			<button class:active={typeFilter === t} onclick={() => (typeFilter = t as typeof typeFilter)}>{t}</button>
		{/each}
	</div>
	<div class="kinds">
		{#each ['all', '5m', '1h', '24h'] as r}
			<button class:active={rangeFilter === r} onclick={() => (rangeFilter = r as typeof rangeFilter)} title={r === 'all' ? 'all time' : `last ${r}`}>{r}</button>
		{/each}
	</div>
</div>

<p class="muted small">{filtered.length} of {rows.length}{#if rows.length === 500} (capped){/if}</p>

<table>
	<thead>
		<tr>
			<th class="sortable" onclick={() => sort.toggle('type')}>Type<span class="arr">{sort.indicator('type')}</span></th>
			<th class="sortable" onclick={() => sort.toggle('namespace')}>Namespace<span class="arr">{sort.indicator('namespace')}</span></th>
			<th class="sortable" onclick={() => sort.toggle('involved')}>Involved<span class="arr">{sort.indicator('involved')}</span></th>
			<th class="sortable" onclick={() => sort.toggle('reason')}>Reason<span class="arr">{sort.indicator('reason')}</span></th>
			<th>Message</th>
			<th class="num sortable" onclick={() => sort.toggle('count')}>Count<span class="arr">{sort.indicator('count')}</span></th>
			<th class="sortable" onclick={() => sort.toggle('lastSeen')}>Last seen<span class="arr">{sort.indicator('lastSeen')}</span></th>
		</tr>
	</thead>
	<tbody>
		{#each filtered as e, i}
			<tr class:row-focused={i === kbd.focusedIdx} class:warn={e.type === 'Warning'}>
				<td><span class="ev-type ev-type-{e.type.toLowerCase()}">{e.type}</span></td>
				<td><Highlight text={e.namespace} {q} /></td>
				<td class="mono"><Highlight text={e.involved} {q} /></td>
				<td class="mono"><Highlight text={e.reason} {q} /></td>
				<td class="msg"><Highlight text={e.message} {q} /></td>
				<td class="num">{e.count}</td>
				<td>{age(e.lastSeen)}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.head-actions { display: inline-flex; gap: 0.5rem; align-items: center; }
	.live-toggle { display: inline-flex; gap: 0.4rem; align-items: center; font-size: 0.85rem; color: var(--fg-soft); padding: 0.4rem 0.75rem; border: 1px solid var(--rule); border-radius: 6px; cursor: pointer; }
	.live-toggle input { accent-color: var(--accent); }
	.ghost { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.ghost:disabled { cursor: not-allowed; opacity: 0.5; }

	.controls { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin: 1rem 0 0.5rem; }
	.search { flex: 1 1 260px; min-width: 220px; padding: 0.5rem 0.8rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px; color: var(--fg); font: inherit; }
	.search:focus { outline: none; border-color: var(--accent); }
	.kinds { display: inline-flex; gap: 0.25rem; }
	.kinds button { font: inherit; font-size: 0.8rem; padding: 0.4rem 0.7rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.kinds button.active { color: var(--fg); border-color: var(--accent); }

	.small { font-size: 0.85rem; margin: 0.5rem 0 1rem; }

	table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
	th { text-align: left; padding: 0.4rem 0.6rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: top; }
	tr:hover td { background: var(--bg-elev); }
	tr.warn td { color: var(--fg); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.msg { color: var(--fg); max-width: 480px; }

	.ev-type { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 4px; font-size: 0.7rem; }
	.ev-type-normal { color: var(--muted); border: 1px solid var(--rule); }
	.ev-type-warning { color: #fcd34d; border: 1px solid #fcd34d; }

	tr.row-focused td { box-shadow: inset 2px 0 0 var(--accent); }

	.error { padding: 0.75rem 1rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 8px; color: #fb7185; }

	th.sortable { cursor: pointer; user-select: none; }
	th.sortable:hover { color: var(--fg); }
	th .arr { display: inline-block; margin-left: 0.3rem; color: var(--accent); font-size: 0.85em; min-width: 0.6em; }
</style>
