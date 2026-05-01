<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let q = $state('');
	let kindFilter = $state<'all' | 'Pod' | 'Deployment' | 'StatefulSet'>('all');
	let statusFilter = $state<string>('all');
	let refreshing = $state(false);

	const distinctStatuses = $derived(
		Array.from(new Set(data.rows.map((r) => r.status))).sort()
	);

	// Namespace filtering happens server-side via /k8s/+layout.svelte
	// (URL ?ns=). Client only handles kind/status/text search now.
	const filtered = $derived(
		data.rows.filter((r) => {
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
</script>

<div class="header">
	<h1>Workloads</h1>
	<button class="refresh" onclick={refresh} disabled={refreshing} title="Refresh">
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

{#if data.error}
	<p class="error">Failed to list workloads: {data.error}</p>
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

<p class="muted small">{filtered.length} of {data.rows.length} resources</p>

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
		</tr>
	</thead>
	<tbody>
		{#each filtered as r}
			<tr>
				<td>{r.namespace}</td>
				<td><span class="kind kind-{r.kind.toLowerCase()}">{r.kind}</span></td>
				<td class="name">{r.name}</td>
				<td>{r.ready}</td>
				<td><span class="status status-{r.status.toLowerCase()}">{r.status}</span></td>
				<td>{r.restarts || ''}</td>
				<td>{age(r.creationTimestamp)}</td>
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
		cursor: wait;
		opacity: 0.6;
	}
	.refresh .spin {
		display: inline-block;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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
	.search:focus {
		outline: none;
		border-color: var(--accent);
	}


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
	.kinds button:hover {
		color: var(--fg);
		border-color: var(--muted);
		opacity: 1;
	}
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
	tr:hover td {
		background: var(--bg-elev);
	}
	td.name {
		color: var(--fg);
		font-family: var(--font-mono);
		font-size: 0.85em;
	}

	.kind {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--bg-elev);
		color: var(--fg-soft);
	}
	.kind-deployment {
		color: #a5b4fc;
	}
	.kind-statefulset {
		color: #c4b5fd;
	}
	.kind-pod {
		color: var(--muted);
	}

	.status {
		font-size: 0.8rem;
	}
	.status-running,
	.status-ready {
		color: #6ee7b7;
	}
	.status-pending {
		color: #fcd34d;
	}
	.status-succeeded {
		color: #93c5fd;
	}
	.status-failed,
	.status-error,
	.status-crashloopbackoff,
	.status-unknown {
		color: #fb7185;
	}

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}
</style>
