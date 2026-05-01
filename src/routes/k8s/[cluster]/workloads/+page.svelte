<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { WorkloadRow } from './+page.server';
	import { page } from '$app/state';

	let { data } = $props();

	let q = $state('');
	let kindFilter = $state<'all' | 'Pod' | 'Deployment' | 'StatefulSet'>('all');
	let statusFilter = $state<string>('all');
	let refreshing = $state(false);
	let live = $state(false);
	let actionMsg = $state<string | null>(null);
	let actionErr = $state<string | null>(null);

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
		// or invalidateAll). Live mode rebuilds from this seed.
		localRows = data.rows;
		if (live) {
			seedLiveMap();
		}
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
		const u = new URL(`/k8s/${data.cluster}/api/watch/workloads`, window.location.origin);
		const ns = page.url.searchParams.get('ns') || '';
		if (ns) u.searchParams.set('ns', ns);
		es = new EventSource(u.toString());
		es.onmessage = (ev) => {
			try {
				const msg = JSON.parse(ev.data) as
					| { kind: 'error'; message: string }
					| { kind: 'Pod' | 'Deployment' | 'StatefulSet'; type: string; item: WorkloadRow };
				if ('message' in msg) {
					actionErr = msg.message;
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
		es.onerror = () => {
			// Browser will auto-reconnect; surface a hint if connection
			// stays down for a while in a follow-up enhancement.
		};
	}

	function stopLive() {
		es?.close();
		es = null;
	}

	$effect(() => {
		if (live) startLive();
		else stopLive();
	});

	onDestroy(stopLive);

	const distinctStatuses = $derived(
		Array.from(new Set(localRows.map((r) => r.status))).sort()
	);

	const filtered = $derived(
		localRows.filter((r) => {
			if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
			if (statusFilter !== 'all' && r.status !== statusFilter) return false;
			if (q && !`${r.namespace}/${r.name}`.toLowerCase().includes(q.toLowerCase())) return false;
			return true;
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

	async function postAction(action: string, body: object) {
		actionMsg = null;
		actionErr = null;
		try {
			const res = await fetch(`/k8s/${data.cluster}/api/${action}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const text = await res.text();
				actionErr = `${action} failed (${res.status}): ${text || res.statusText}`;
				return;
			}
			actionMsg = `${action} ok`;
			if (!live) await invalidateAll();
		} catch (err) {
			actionErr = `${action} failed: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	function onRestart(r: WorkloadRow) {
		if (!confirm(`Restart ${r.kind} ${r.namespace}/${r.name}?\n\nRolls a new revision.`)) return;
		postAction('restart', { kind: r.kind, namespace: r.namespace, name: r.name });
	}
	function onScale(r: WorkloadRow) {
		const cur = r.ready.split('/')[1] ?? '0';
		const next = prompt(`Scale ${r.kind} ${r.namespace}/${r.name} to N replicas:`, cur);
		if (next == null) return;
		const n = Number(next);
		if (!Number.isInteger(n) || n < 0) {
			actionErr = 'replicas must be a non-negative integer';
			return;
		}
		postAction('scale', { kind: r.kind, namespace: r.namespace, name: r.name, replicas: n });
	}
	function onDelete(r: WorkloadRow) {
		if (!confirm(`Delete pod ${r.namespace}/${r.name}?\n\nController will respawn it if it has one.`))
			return;
		postAction('pod-delete', { namespace: r.namespace, name: r.name });
	}
</script>

<div class="header">
	<h1>Workloads</h1>
	<div class="head-actions">
		<label class="live">
			<input type="checkbox" bind:checked={live} />
			<span class="dot {live ? 'on' : 'off'}"></span> Live
		</label>
		<button class="refresh" onclick={refresh} disabled={refreshing || live} title={live ? 'Disabled while Live' : 'Refresh'}>
			<span class:spin={refreshing}>↻</span> Refresh
		</button>
	</div>
</div>

{#if data.error}
	<p class="error">Failed to list workloads: {data.error}</p>
{/if}
{#if actionErr}
	<p class="error">{actionErr}</p>
{/if}
{#if actionMsg}
	<p class="ok">{actionMsg}</p>
{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by name…" />
	<div class="kinds">
		{#each ['all', 'Pod', 'Deployment', 'StatefulSet'] as k}
			<button class:active={kindFilter === k} onclick={() => (kindFilter = k as typeof kindFilter)}>
				{k}
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

<table>
	<thead>
		<tr>
			<th>Namespace</th>
			<th>Kind</th>
			<th>Name</th>
			<th>Ready</th>
			<th>Status</th>
			<th>Restarts</th>
			<th>Age</th>
			{#if canWrite}
				<th>Actions</th>
			{/if}
		</tr>
	</thead>
	<tbody>
		{#each filtered as r}
			<tr>
				<td>{r.namespace}</td>
				<td><span class="kind kind-{r.kind.toLowerCase()}">{r.kind}</span></td>
				<td class="name">
					{#if r.kind === 'Pod'}
						<a href="/k8s/{data.cluster}/pod/{r.namespace}/{r.name}">{r.name}</a>
					{:else}
						{r.name}
					{/if}
				</td>
				<td>{r.ready}</td>
				<td><span class="status status-{r.status.toLowerCase()}">{r.status}</span></td>
				<td>{r.restarts || ''}</td>
				<td>{age(r.creationTimestamp)}</td>
				{#if canWrite}
					<td class="actions">
						{#if r.kind === 'Deployment' || r.kind === 'StatefulSet'}
							<button class="act" onclick={() => onRestart(r)} title="Rollout restart">restart</button>
							<button class="act" onclick={() => onScale(r)} title="Scale replicas">scale</button>
						{/if}
						{#if r.kind === 'Pod'}
							<button class="act danger" onclick={() => onDelete(r)} title="Delete pod">delete</button>
						{/if}
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
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.dot.on { background: #6ee7b7; box-shadow: 0 0 6px #6ee7b7; }
	.dot.off { background: var(--muted); }

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

	.error {
		padding: 0.6rem 0.9rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
		font-size: 0.85rem;
		margin: 0.5rem 0;
	}
	.ok {
		padding: 0.6rem 0.9rem;
		background: rgba(110, 231, 183, 0.1);
		border: 1px solid #6ee7b7;
		border-radius: 8px;
		color: #6ee7b7;
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
</style>
