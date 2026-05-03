<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import type { WorkloadRow } from './+page.server';
	import { page } from '$app/state';
	import KubectlMenu from '$lib/KubectlMenu.svelte';
	import { registerLive, unregisterLive } from '$lib/live-registry.svelte';
	import { toast } from '$lib/toast.svelte';
	import LiveDot from '$lib/LiveDot.svelte';
	import type { LiveStreamState } from '$lib/live-list.svelte';
	import { goto } from '$app/navigation';
	import { createKbdNav } from '$lib/kbd-nav.svelte';
	import Highlight from '$lib/Highlight.svelte';
	import { confirm as confirmDialog } from '$lib/confirm.svelte';
	import { rowClick } from '$lib/row-click';

	let { data } = $props();

	// Persist filter + sort prefs across reloads. Keyed under a single
	// JSON blob so we don't pollute localStorage with N keys, and so a
	// future schema change can ship a single version bump.
	const PREF_KEY = 'platform-dash:workloads:v1';
	type Prefs = {
		kindFilter: 'all' | 'Pod' | 'Deployment' | 'StatefulSet';
		statusFilter: string;
		sortKey: 'chaos' | 'namespace' | 'kind' | 'name' | 'ready' | 'status' | 'restarts' | 'image' | 'node' | 'age';
		sortDir: 'asc' | 'desc';
	};
	const initialPrefs: Prefs = (() => {
		if (typeof localStorage === 'undefined') return { kindFilter: 'all', statusFilter: 'all', sortKey: 'chaos', sortDir: 'desc' };
		try {
			const raw = localStorage.getItem(PREF_KEY);
			if (!raw) throw new Error();
			const parsed = JSON.parse(raw) as Prefs;
			return {
				kindFilter: parsed.kindFilter ?? 'all',
				statusFilter: parsed.statusFilter ?? 'all',
				sortKey: parsed.sortKey ?? 'chaos',
				sortDir: parsed.sortDir ?? 'desc'
			};
		} catch {
			return { kindFilter: 'all', statusFilter: 'all', sortKey: 'chaos', sortDir: 'desc' };
		}
	})();

	let q = $state('');
	let kindFilter = $state<Prefs['kindFilter']>(initialPrefs.kindFilter);
	let statusFilter = $state<string>(initialPrefs.statusFilter);
	let refreshing = $state(false);
	let live = $state(false);
	let streamState = $state<LiveStreamState>('idle');

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const prefs: Prefs = { kindFilter, statusFilter, sortKey, sortDir };
		try {
			localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
		} catch {
			/* quota exceeded / disabled — silent */
		}
	});

	// canWrite comes from the layout (per-cluster aware). Hide action
	// buttons entirely for sre / no-role rather than greying — fewer
	// affordances reduces accidental clicks under stress.
	const canWrite = $derived(!!page.data.canWrite);

	// Live mode keeps a local row map keyed by `${kind}|${ns}|${name}`
	// so watch deltas can splice in place. The initial rows from the
	// loader seed the map; ADDED/MODIFIED upserts; DELETED removes.
	let localRows = $state<WorkloadRow[]>([]);
	let liveRowMap = new Map<string, WorkloadRow>();
	let es: EventSource | null = null;

	$effect(() => {
		// Reset local view whenever the loader fires (cluster/ns change
		// or invalidateAll). Live mode rebuilds from this seed. The
		// body is untracked so reading `localRows` inside seedLiveMap
		// doesn't re-fire this effect when SSE deltas mutate localRows.
		const rows = data.rows;
		untrack(() => {
			localRows = rows;
			if (live) seedLiveMap();
		});
	});

	function seedLiveMap() {
		liveRowMap = new Map(localRows.map((r) => [`${r.kind}|${r.namespace}|${r.name}`, r]));
	}

	function rebuildFromLiveMap() {
		const arr = Array.from(liveRowMap.values());
		arr.sort((a, b) => {
			if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
			if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
			return a.name.localeCompare(b.name);
		});
		localRows = arr;
	}

	function startLive() {
		if (es) return;
		seedLiveMap();
		streamState = 'connecting';
		const u = new URL(`/k8s/${data.cluster}/api/watch/workloads`, window.location.origin);
		const ns = page.url.searchParams.get('ns') || '';
		if (ns) u.searchParams.set('ns', ns);
		const src = new EventSource(u.toString());
		es = src;
		// Hand the closer to the registry so any external navigation
		// (ns/cluster selector, saved-views jump) can drop the SSE
		// before its goto() blocks on an HTTP/1.1 connection slot.
		registerLive(`workloads:${u.pathname}${u.search}`, () => {
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
				const msg = JSON.parse(ev.data) as
					| { kind: 'error'; message: string }
					| { kind: 'Pod' | 'Deployment' | 'StatefulSet'; type: string; item: WorkloadRow };
				if ('message' in msg) {
					toast.show(msg.message, 'err');
					return;
				}
				const key = `${msg.item.kind}|${msg.item.namespace}|${msg.item.name}`;
				if (msg.type === 'DELETED') liveRowMap.delete(key);
				else liveRowMap.set(key, msg.item);
				rebuildFromLiveMap();
			} catch {
				/* malformed event, skip */
			}
		};
		src.onerror = () => {
			if (es !== src) return;
			streamState = src.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting';
		};
	}

	function stopLive() {
		if (es) {
			const u = new URL(`/k8s/${data.cluster}/api/watch/workloads`, window.location.origin);
			const ns = page.url.searchParams.get('ns') || '';
			if (ns) u.searchParams.set('ns', ns);
			unregisterLive(`workloads:${u.pathname}${u.search}`);
			es = null;
		}
		streamState = 'idle';
	}

	$effect(() => {
		// Re-runs when `live` flips OR when the URL ?ns= changes —
		// reading page.url here makes Svelte track it. Open/close are
		// untracked because `startLive` reads `localRows` to seed the
		// map; without untrack the effect would track `localRows` too
		// and every SSE delta would close + reopen the stream.
		const _ns = page.url.searchParams.get('ns'); // tracked dependency
		void _ns;
		const isLive = live;
		untrack(() => {
			stopLive();
			if (isLive) startLive();
		});
	});

	onDestroy(stopLive);

	const kbd = createKbdNav({
		rowCount: () => filtered.length,
		onEnter: (i) => {
			const r = filtered[i];
			if (r?.kind === 'Pod') goto(`/k8s/${data.cluster}/pod/${r.namespace}/${r.name}`);
		},
		onSelect: (i) => {
			if (!canWrite) return;
			const r = filtered[i];
			if (r) toggleSelected(r);
		},
		onEscape: () => {
			if (selected.size > 0) {
				clearSelection();
				return true;
			}
			return false;
		}
	});
	$effect(() => kbd.attach());

	const distinctStatuses = $derived(
		Array.from(new Set(localRows.map((r) => r.status))).sort()
	);

	// Sort. `chaos` is a synthetic column that surfaces the worst rows
	// at the top: status weight first (failed/error/crashloop > pending
	// > running > succeeded), then restart count desc, then ns/name.
	// Defaults to chaos+desc so the first thing the operator sees on
	// page load is whatever's blowing up.
	type SortKey = Prefs['sortKey'];
	type SortDir = Prefs['sortDir'];
	let sortKey = $state<SortKey>(initialPrefs.sortKey);
	let sortDir = $state<SortDir>(initialPrefs.sortDir);

	function statusWeight(s: string): number {
		const k = s.toLowerCase();
		if (k === 'failed' || k === 'error' || k === 'crashloopbackoff' || k === 'imagepullbackoff') return 5;
		if (k === 'unknown') return 4;
		if (k === 'pending') return 3;
		if (k === 'running' || k === 'ready') return 2;
		if (k === 'succeeded') return 1;
		return 0;
	}

	function readyRatio(r: WorkloadRow): number {
		const [a, b] = r.ready.split('/').map(Number);
		if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
		return a / b;
	}

	function ageMs(r: WorkloadRow): number {
		return r.creationTimestamp ? Date.parse(r.creationTimestamp) || 0 : 0;
	}

	function compare(a: WorkloadRow, b: WorkloadRow, key: SortKey): number {
		switch (key) {
			case 'chaos': {
				const sw = statusWeight(b.status) - statusWeight(a.status);
				if (sw !== 0) return sw;
				const r = b.restarts - a.restarts;
				if (r !== 0) return r;
				const rr = readyRatio(a) - readyRatio(b); // less-ready first
				if (rr !== 0) return rr;
				if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
				return a.name.localeCompare(b.name);
			}
			case 'namespace':
				return a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
			case 'kind':
				return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
			case 'name':
				return a.name.localeCompare(b.name);
			case 'ready':
				return readyRatio(a) - readyRatio(b);
			case 'status':
				return statusWeight(a.status) - statusWeight(b.status) || a.status.localeCompare(b.status);
			case 'restarts':
				return a.restarts - b.restarts;
			case 'image': {
				// ImagePullError rows surface first regardless of dir,
				// then alpha by image string. Pods sharing an image get
				// secondary sort by ns/name so groups stay readable.
				const aBad = a.imagePullError ? 1 : 0;
				const bBad = b.imagePullError ? 1 : 0;
				if (aBad !== bBad) return bBad - aBad;
				const ai = a.image ?? '';
				const bi = b.image ?? '';
				return ai.localeCompare(bi) || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
			}
			case 'node': {
				// Group by node, then ns/name within. Pods without a node
				// (e.g. Pending / unscheduled, or Deployment/StatefulSet
				// rollups) sink to the bottom regardless of sort dir so
				// scheduled rows stay readable.
				const an = a.node ?? '';
				const bn = b.node ?? '';
				if (!an && bn) return 1;
				if (an && !bn) return -1;
				return an.localeCompare(bn) || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
			}
			case 'age':
				// Older creationTimestamp = older row; "asc" should mean oldest first
				return ageMs(a) - ageMs(b);
		}
	}

	function setSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			// Numeric / chaos columns default to desc (worst first); text to asc.
			sortDir = key === 'namespace' || key === 'name' || key === 'kind' ? 'asc' : 'desc';
		}
	}

	function sortIndicator(key: SortKey): string {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? ' ▲' : ' ▼';
	}

	const filtered = $derived(
		localRows
			.filter((r) => {
				if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
				if (statusFilter !== 'all' && r.status !== statusFilter) return false;
				if (q && !`${r.namespace}/${r.name}`.toLowerCase().includes(q.toLowerCase())) return false;
				return true;
			})
			.slice()
			.sort((a, b) => {
				const c = compare(a, b, sortKey);
				return sortDir === 'asc' ? c : -c;
			})
	);

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	async function postAction(action: string, body: object, opts?: { skipInvalidate?: boolean }) {
		try {
			const res = await fetch(`/k8s/${data.cluster}/api/${action}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const text = await res.text();
				toast.show(`${action} failed (${res.status}): ${text || res.statusText}`, 'err');
				return false;
			}
			toast.show(`${action} ok`);
			// In live mode the watch SSE streams the change back. Out of
			// live mode we either re-load (default) or trust the optimistic
			// splice the caller already performed.
			if (!live && !opts?.skipInvalidate) await invalidateAll();
			return true;
		} catch (err) {
			toast.show(`${action} failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
			return false;
		}
	}

	// Optimistic splice: drop a row from localRows / liveRowMap before
	// the API round-trip lands so the table reflects the action without
	// a full re-loader flash. Returns the original row so callers can
	// restore it on failure.
	function spliceOut(r: WorkloadRow): WorkloadRow | null {
		const k = `${r.kind}|${r.namespace}|${r.name}`;
		const had = localRows.find((x) => `${x.kind}|${x.namespace}|${x.name}` === k);
		if (!had) return null;
		liveRowMap.delete(k);
		localRows = localRows.filter((x) => `${x.kind}|${x.namespace}|${x.name}` !== k);
		return had;
	}
	function spliceIn(r: WorkloadRow) {
		const k = `${r.kind}|${r.namespace}|${r.name}`;
		liveRowMap.set(k, r);
		localRows = [...localRows, r];
	}

	// ── Bulk selection ───────────────────────────────────────────────
	let selected = $state<Set<string>>(new Set());
	function rowKey(r: WorkloadRow): string {
		return `${r.kind}|${r.namespace}|${r.name}`;
	}
	function isSelected(r: WorkloadRow): boolean {
		return selected.has(rowKey(r));
	}
	function toggleSelected(r: WorkloadRow) {
		const k = rowKey(r);
		const next = new Set(selected);
		if (next.has(k)) next.delete(k);
		else next.add(k);
		selected = next;
	}
	function selectAllVisible() {
		const next = new Set(selected);
		for (const r of filtered) next.add(rowKey(r));
		selected = next;
	}
	function clearSelection() {
		selected = new Set();
	}
	const selectedRows = $derived(filtered.filter((r) => selected.has(rowKey(r))));
	const allVisibleSelected = $derived(
		filtered.length > 0 && filtered.every((r) => selected.has(rowKey(r)))
	);

	const bulkPods = $derived(selectedRows.filter((r) => r.kind === 'Pod'));
	const bulkRestartable = $derived(
		selectedRows.filter((r) => r.kind === 'Deployment' || r.kind === 'StatefulSet')
	);

	async function bulkDelete() {
		if (bulkPods.length === 0) return;
		const proceed = await confirmDialog({
			title: `Delete ${bulkPods.length} pod${bulkPods.length === 1 ? '' : 's'}?`,
			body: `Controllers will respawn pods that have one.\n\n${bulkPods.map((p) => `· ${p.namespace}/${p.name}`).slice(0, 8).join('\n')}${bulkPods.length > 8 ? `\n· …and ${bulkPods.length - 8} more` : ''}`,
			confirm: 'Delete',
			danger: true
		});
		if (!proceed) return;
		// Optimistic: drop selected pods immediately, restore the ones
		// whose API call comes back failing. Live mode will receive the
		// canonical DELETED event regardless and idempotently confirm.
		const snapshots = bulkPods.map((p) => ({ row: p, snap: spliceOut(p) }));
		clearSelection();
		let ok = 0;
		let fail = 0;
		await Promise.all(
			snapshots.map(async ({ row, snap }) => {
				const res = await fetch(`/k8s/${data.cluster}/api/pod-delete`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ namespace: row.namespace, name: row.name })
				});
				if (res.ok) ok++;
				else {
					fail++;
					if (snap) spliceIn(snap);
				}
			})
		);
		toast.show(`delete: ${ok} ok${fail ? ` · ${fail} failed` : ''}`, fail > 0 ? 'err' : 'ok');
		// No invalidateAll: the optimistic splice already removed the
		// successful rows; controllers will respawn pods that have one
		// and the next user-driven refresh (or live mode) picks them up.
	}

	async function bulkRestart() {
		if (bulkRestartable.length === 0) return;
		const proceed = await confirmDialog({
			title: `Rollout restart ${bulkRestartable.length} workload${bulkRestartable.length === 1 ? '' : 's'}?`,
			body: bulkRestartable.map((r) => `· ${r.kind} ${r.namespace}/${r.name}`).slice(0, 8).join('\n') + (bulkRestartable.length > 8 ? `\n· …and ${bulkRestartable.length - 8} more` : ''),
			confirm: 'Restart'
		});
		if (!proceed) return;
		let ok = 0;
		let fail = 0;
		await Promise.all(
			bulkRestartable.map(async (r) => {
				const res = await fetch(`/k8s/${data.cluster}/api/restart`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: r.kind, namespace: r.namespace, name: r.name })
				});
				if (res.ok) ok++;
				else fail++;
			})
		);
		toast.show(`restart: ${ok} ok${fail ? ` · ${fail} failed` : ''}`, fail > 0 ? 'err' : 'ok');
		clearSelection();
		if (!live) await invalidateAll();
	}

	async function onRestart(r: WorkloadRow) {
		const proceed = await confirmDialog({
			title: `Restart ${r.kind}?`,
			body: `${r.namespace}/${r.name}\n\nRolls a new revision; pods are recreated one by one.`,
			confirm: 'Restart'
		});
		if (!proceed) return;
		postAction('restart', { kind: r.kind, namespace: r.namespace, name: r.name });
	}
	function onScale(r: WorkloadRow) {
		const cur = r.ready.split('/')[1] ?? '0';
		const next = prompt(`Scale ${r.kind} ${r.namespace}/${r.name} to N replicas:`, cur);
		if (next == null) return;
		const n = Number(next);
		if (!Number.isInteger(n) || n < 0) {
			toast.show('replicas must be a non-negative integer', 'err');
			return;
		}
		postAction('scale', { kind: r.kind, namespace: r.namespace, name: r.name, replicas: n });
	}
	async function onDelete(r: WorkloadRow) {
		const proceed = await confirmDialog({
			title: 'Delete pod?',
			body: `${r.namespace}/${r.name}\n\nController will respawn it if it has one.`,
			confirm: 'Delete',
			danger: true
		});
		if (!proceed) return;
		const snap = spliceOut(r);
		const ok = await postAction(
			'pod-delete',
			{ namespace: r.namespace, name: r.name },
			{ skipInvalidate: true }
		);
		if (!ok && snap) spliceIn(snap);
	}
</script>

<div class="header">
	<h1>Workloads</h1>
	<div class="head-actions">
		<label class="live">
			<input type="checkbox" bind:checked={live} />
			<LiveDot state={streamState} /> Live
		</label>
		<button class="refresh" onclick={refresh} disabled={refreshing || live} title={live ? 'Disabled while Live' : 'Refresh'}>
			<span class:spin={refreshing}>↻</span> Refresh
		</button>
	</div>
</div>

{#if data.error}
	<p class="error">Failed to list workloads: {data.error}</p>
{/if}
<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by name…" />
	<div class="kinds">
		{#each ['all', 'Pod', 'Deployment', 'StatefulSet'] as k}
			{@const count = k === 'all' ? localRows.length : localRows.filter((r) => r.kind === k).length}
			<button class:active={kindFilter === k} onclick={() => (kindFilter = k as typeof kindFilter)}>
				{k} <span class="count">{count}</span>
			</button>
		{/each}
	</div>
</div>

<div class="controls">
	<div class="kinds statuses">
		<button class:active={statusFilter === 'all'} onclick={() => (statusFilter = 'all')}>
			all
		</button>
		{#each distinctStatuses as s}
			<button class:active={statusFilter === s} onclick={() => (statusFilter = s)}>
				<span class="status status-{s.toLowerCase()}">{s}</span>
			</button>
		{/each}
	</div>
</div>

<p class="muted small">{filtered.length} of {localRows.length} resources</p>

<p class="muted small sort-hint">
	<span class="hint-item">sort: <button class="sort-reset" onclick={() => { sortKey = 'chaos'; sortDir = 'desc'; }} class:active={sortKey === 'chaos'}>chaos</button></span>
	{#if sortKey !== 'chaos'}<span class="hint-sep">·</span><span class="hint-item">click any column header to re-sort</span>{/if}
	<span class="hint-sep">·</span>
	<span class="hint-item">press <kbd>?</kbd> for keyboard shortcuts</span>
</p>

{#if canWrite && selected.size > 0}
	<div class="bulk-bar">
		<span class="bulk-count">{selected.size} selected</span>
		{#if bulkRestartable.length > 0}
			<button class="bulk-act" onclick={bulkRestart}>
				restart {bulkRestartable.length} workload{bulkRestartable.length === 1 ? '' : 's'}
			</button>
		{/if}
		{#if bulkPods.length > 0}
			<button class="bulk-act danger" onclick={bulkDelete}>
				delete {bulkPods.length} pod{bulkPods.length === 1 ? '' : 's'}
			</button>
		{/if}
		<button class="bulk-act" onclick={clearSelection}>clear</button>
	</div>
{/if}

<table>
	<thead>
		<tr>
			{#if canWrite}
				<th class="check">
					<input
						type="checkbox"
						checked={allVisibleSelected}
						onchange={(e) =>
							(e.currentTarget as HTMLInputElement).checked
								? selectAllVisible()
								: clearSelection()}
						title="Select / clear all visible"
					/>
				</th>
			{/if}
			<th class="sortable" onclick={() => setSort('namespace')}>Namespace{sortIndicator('namespace')}</th>
			<th class="sortable" onclick={() => setSort('kind')}>Kind{sortIndicator('kind')}</th>
			<th class="sortable" onclick={() => setSort('name')}>Name{sortIndicator('name')}</th>
			<th class="sortable" onclick={() => setSort('ready')}>Ready{sortIndicator('ready')}</th>
			<th class="sortable" onclick={() => setSort('status')}>Status{sortIndicator('status')}</th>
			<th class="sortable" onclick={() => setSort('restarts')}>Restarts{sortIndicator('restarts')}</th>
			<th class="sortable" onclick={() => setSort('image')}>Image{sortIndicator('image')}</th>
			<th class="sortable" onclick={() => setSort('node')}>Node{sortIndicator('node')}</th>
			<th class="sortable" onclick={() => setSort('age')}>Age{sortIndicator('age')}</th>
			<th>Actions</th>
		</tr>
	</thead>
	<tbody>
		{#each filtered as r, i}
			<tr
				class:row-selected={isSelected(r)}
				class:row-focused={i === kbd.focusedIdx}
				class:clickable={r.kind === 'Pod'}
				onclick={r.kind === 'Pod' ? rowClick(`/k8s/${data.cluster}/pod/${r.namespace}/${r.name}`) : undefined}
			>
				{#if canWrite}
					<td class="check">
						<input
							type="checkbox"
							checked={isSelected(r)}
							onchange={() => toggleSelected(r)}
						/>
					</td>
				{/if}
				<td><Highlight text={r.namespace} {q} /></td>
				<td><span class="kind kind-{r.kind.toLowerCase()}">{r.kind}</span></td>
				<td class="name">
					{#if r.kind === 'Pod'}
						<a href="/k8s/{data.cluster}/pod/{r.namespace}/{r.name}"><Highlight text={r.name} {q} /></a>
					{:else}
						<a href="/k8s/{data.cluster}/workload/{r.kind}/{r.namespace}/{r.name}"><Highlight text={r.name} {q} /></a>
					{/if}
				</td>
				<td>{r.ready}</td>
				<td>
					<span class="status status-{r.status.toLowerCase()}">{r.status}</span>
					{#if r.lastTermReason === 'OOMKilled'}
						<span class="reason-pill oom" title="Last termination: OOMKilled — container hit its memory limit (or the node had system OOM)">OOM</span>
					{:else if r.lastTermReason}
						<span class="reason-pill" title="Last termination reason: {r.lastTermReason}">{r.lastTermReason}</span>
					{/if}
				</td>
				<td>{r.restarts || ''}</td>
				<td class="image">
					{#if r.image}
						<span class="image-tag" class:bad={r.imagePullError} title={r.imagePullError ? 'ImagePullBackOff / ErrImagePull' : r.image}>{r.image}</span>
					{:else}
						<span class="muted">—</span>
					{/if}
				</td>
				<td class="node">{#if r.node}<a href="/k8s/{data.cluster}/nodes#{r.node}">{r.node}</a>{:else}<span class="muted">—</span>{/if}</td>
				<td>{age(r.creationTimestamp)}</td>
				{#if canWrite}
					<td class="actions">
						<KubectlMenu target={{ cluster: data.cluster, kind: r.kind, namespace: r.namespace, name: r.name }} />
						{#if r.kind === 'Deployment' || r.kind === 'StatefulSet'}
							<button class="act" onclick={() => onRestart(r)} title="Rollout restart">restart</button>
							<button class="act" onclick={() => onScale(r)} title="Scale replicas">scale</button>
						{/if}
						{#if r.kind === 'Pod'}
							<button class="act danger" onclick={() => onDelete(r)} title="Delete pod">delete</button>
						{/if}
					</td>
				{:else}
					<td class="actions">
						<KubectlMenu target={{ cluster: data.cluster, kind: r.kind, namespace: r.namespace, name: r.name }} />
					</td>
				{/if}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.head-actions {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
	}

	.live {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.85rem;
		color: var(--fg-soft);
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--rule);
		border-radius: 6px;
		cursor: pointer;
	}
	.live input { accent-color: var(--accent); }

	.refresh {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.refresh:hover:not(:disabled) {
		color: var(--fg);
		border-color: var(--muted);
	}
	.refresh:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	.refresh .spin {
		display: inline-block;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.controls {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		margin: 1rem 0 0.5rem;
		flex-wrap: wrap;
	}

	.search {
		flex: 1 1 240px;
		min-width: 0;
		padding: 0.5rem 0.8rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
		color: var(--fg);
		font: inherit;
	}
	.search:focus { outline: none; border-color: var(--accent); }

	.kinds {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}
	.kinds button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
	}
	.kinds button:hover { color: var(--fg); border-color: var(--muted); }
	.kinds button.active {
		background: var(--bg-elev);
		color: var(--accent);
		border-color: var(--accent);
	}
	.kinds button .count {
		font-family: var(--font-mono);
		font-size: 0.72em;
		opacity: 0.7;
		margin-left: 0.2rem;
	}

	.small {
		font-size: 0.85rem;
		margin: 0.5rem 0 1rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th {
		text-align: left;
		padding: 0.5rem 0.75rem;
		color: var(--muted);
		font-weight: 500;
		border-bottom: 1px solid var(--rule);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	th.sortable {
		cursor: pointer;
		user-select: none;
	}
	th.sortable:hover { color: var(--fg); }

	.sort-hint {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: var(--muted);
		margin: 0.5rem 0 0.5rem;
	}
	.sort-reset {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.1rem 0.55rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 4px;
		cursor: pointer;
		vertical-align: baseline;
	}
	.sort-reset:hover { color: var(--fg); border-color: var(--muted); }
	.sort-reset.active { color: var(--accent); border-color: var(--accent); }
	.sort-hint kbd {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		padding: 0.05rem 0.35rem;
		border: 1px solid var(--rule);
		border-bottom-width: 2px;
		border-radius: 3px;
		color: var(--fg);
		background: var(--bg-elev);
	}
	.hint-item { display: inline-flex; align-items: center; gap: 0.35rem; }
	.hint-sep { color: var(--muted); }

	td.image { max-width: 280px; }
	.image-tag {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: 0.78em;
		padding: 0.1rem 0.45rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 4px;
		color: var(--fg);
		max-width: 280px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.image-tag.bad { color: #fb7185; border-color: #fb7185; }
	td {
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		color: var(--fg-soft);
	}
	tr:hover td { background: var(--bg-elev); }
	td.name {
		color: var(--fg);
		font-family: var(--font-mono);
		font-size: 0.85em;
	}
	td.name a { color: var(--fg); }
	td.name a:hover { color: var(--accent); }
	td.actions { white-space: nowrap; }

	.kind {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--bg-elev);
		color: var(--fg-soft);
	}
	.kind-deployment { color: #a5b4fc; }
	.kind-statefulset { color: #c4b5fd; }
	.kind-pod { color: var(--muted); }

	.status { font-size: 0.8rem; }
	.status-running, .status-ready { color: #6ee7b7; }
	.status-pending { color: #fcd34d; }
	.status-succeeded { color: #93c5fd; }
	.status-failed, .status-error, .status-crashloopbackoff, .status-unknown {
		color: #fb7185;
	}

	.reason-pill {
		display: inline-block;
		font-size: 0.68rem;
		padding: 0.05rem 0.4rem;
		margin-left: 0.35rem;
		border-radius: 999px;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		color: var(--fg-soft);
		letter-spacing: 0.04em;
		vertical-align: middle;
	}
	.reason-pill.oom {
		background: rgba(251, 113, 133, 0.15);
		border-color: rgba(251, 113, 133, 0.4);
		color: #fb7185;
		font-weight: 600;
	}

	.error {
		padding: 0.6rem 0.9rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
		font-size: 0.85rem;
		margin: 0.5rem 0;
	}
	.act {
		font: inherit;
		font-size: 0.75rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 4px;
		cursor: pointer;
		margin-right: 0.3rem;
	}
	.act:hover { color: var(--fg); border-color: var(--accent); }
	.act.danger:hover { color: #fb7185; border-color: #fb7185; }

	.bulk-bar {
		position: sticky;
		top: 0;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.6rem 0.85rem;
		margin: 0.5rem 0;
		background: var(--bg-elev);
		border: 1px solid var(--accent);
		border-radius: 8px;
		z-index: 5;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}
	.bulk-count {
		font-size: 0.85rem;
		color: var(--accent);
		font-weight: 500;
		margin-right: 0.5rem;
	}
	.bulk-act {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
	}
	.bulk-act:hover { color: var(--fg); border-color: var(--accent); }
	.bulk-act.danger:hover { color: #fb7185; border-color: #fb7185; }

	th.check, td.check { width: 1.5rem; padding-left: 0.5rem; padding-right: 0; }
	td.check input, th.check input { accent-color: var(--accent); cursor: pointer; }
	tr.row-selected td { background: rgba(165, 180, 252, 0.08); }
	tr.row-focused td { box-shadow: inset 2px 0 0 var(--accent); }
	tr.row-focused.row-selected td { background: rgba(165, 180, 252, 0.14); }
	tr.clickable { cursor: pointer; }
</style>
