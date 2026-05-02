<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let refreshing = $state(false);
	let q = $state('');
	let outcomeFilter = $state<'all' | 'ok' | 'denied' | 'error'>('all');
	let clusterFilter = $state<string>('all');

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	const clusters = $derived(
		Array.from(new Set(data.events.map((e) => e.cluster))).sort()
	);

	const filtered = $derived(
		data.events.filter((e) => {
			if (outcomeFilter !== 'all' && e.outcome !== outcomeFilter) return false;
			if (clusterFilter !== 'all' && e.cluster !== clusterFilter) return false;
			if (!q) return true;
			const needle = q.toLowerCase();
			const hay = `${e.user} ${e.action} ${e.cluster} ${e.target?.kind ?? ''} ${e.target?.namespace ?? ''} ${e.target?.name ?? ''} ${e.message ?? ''}`.toLowerCase();
			return hay.includes(needle);
		})
	);

	function fmtTarget(t: { kind?: string; namespace?: string; name?: string }): string {
		const parts: string[] = [];
		if (t.kind) parts.push(t.kind);
		if (t.namespace) parts.push(t.namespace);
		if (t.name) parts.push(t.name);
		return parts.join('/') || '—';
	}

	function fmtTs(ts: string): string {
		// Compact local time without ms; the user usually wants "when" not exact ISO.
		const d = new Date(ts);
		return d.toLocaleString();
	}
</script>

<div class="header">
	<h1>Audit log</h1>
	<button class="refresh" onclick={refresh} disabled={refreshing}>
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

<p class="muted small">
	Last {data.events.length} write actions (in-memory ring; resets on pod restart).
	Loki / kubectl logs hold the durable stream.
</p>

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by user / action / target / message…" />
	<div class="kinds">
		{#each ['all', 'ok', 'denied', 'error'] as k}
			<button class:active={outcomeFilter === k} onclick={() => (outcomeFilter = k as typeof outcomeFilter)}>{k}</button>
		{/each}
	</div>
	{#if clusters.length > 1}
		<select bind:value={clusterFilter}>
			<option value="all">all clusters</option>
			{#each clusters as c}
				<option value={c}>{c}</option>
			{/each}
		</select>
	{/if}
</div>

<p class="muted small count">{filtered.length} of {data.events.length}</p>

{#if filtered.length === 0}
	<p class="muted small">No matching events.</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>When</th>
				<th>User</th>
				<th>Cluster</th>
				<th>Action</th>
				<th>Target</th>
				<th>Outcome</th>
				<th class="num">ms</th>
				<th>Message</th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as e}
				<tr>
					<td class="ts">{fmtTs(e.ts)}</td>
					<td class="mono">{e.user}</td>
					<td class="mono">{e.cluster}</td>
					<td class="mono">{e.action}</td>
					<td class="mono">{fmtTarget(e.target)}</td>
					<td><span class="outcome outcome-{e.outcome}">{e.outcome}</span></td>
					<td class="num">{e.durationMs ?? ''}</td>
					<td class="msg">{e.message ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.refresh {
		font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem;
		border: 1px solid var(--rule); background: transparent; color: var(--fg-soft);
		border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;
	}
	.refresh:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.refresh:disabled { cursor: wait; opacity: 0.6; }
	.spin { display: inline-block; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.small { font-size: 0.85rem; }
	.count { margin: 0.5rem 0 1rem; }

	.controls {
		display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-top: 1rem;
	}
	.search {
		flex: 1 1 280px; min-width: 240px; padding: 0.5rem 0.8rem;
		background: var(--bg-elev); border: 1px solid var(--rule);
		border-radius: 8px; color: var(--fg); font: inherit;
	}
	.search:focus { outline: none; border-color: var(--accent); }
	.kinds { display: inline-flex; gap: 0.25rem; }
	.kinds button {
		font: inherit; font-size: 0.8rem; padding: 0.4rem 0.7rem;
		border: 1px solid var(--rule); background: transparent; color: var(--fg-soft);
		border-radius: 6px; cursor: pointer;
	}
	.kinds button.active { color: var(--fg); border-color: var(--accent); }
	select {
		font: inherit; font-size: 0.85rem; padding: 0.4rem 0.6rem;
		background: var(--bg-elev); border: 1px solid var(--rule);
		color: var(--fg); border-radius: 6px;
	}

	table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
	th {
		text-align: left; padding: 0.5rem 0.75rem; color: var(--muted);
		font-weight: 500; border-bottom: 1px solid var(--rule);
		font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
		position: sticky; top: 0; background: var(--bg);
	}
	th.num, td.num { text-align: right; }
	td {
		padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--rule);
		color: var(--fg-soft); vertical-align: top;
	}
	tr:hover td { background: var(--bg-elev); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.92em; }
	td.ts { color: var(--muted); white-space: nowrap; font-family: var(--font-mono); font-size: 0.85em; }
	td.msg { color: var(--muted); font-family: var(--font-mono); font-size: 0.85em; max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	td.msg:hover { white-space: normal; }

	.outcome {
		display: inline-block; padding: 0.05rem 0.45rem; border-radius: 3px;
		font-family: var(--font-mono); font-size: 0.78em;
		border: 1px solid var(--rule); color: var(--fg-soft);
	}
	.outcome-ok { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.outcome-denied { color: #fcd34d; border-color: rgba(252, 211, 77, 0.4); }
	.outcome-error { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }
</style>
