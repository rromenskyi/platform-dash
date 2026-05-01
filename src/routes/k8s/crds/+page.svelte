<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let q = $state('');
	let scopeFilter = $state<'all' | 'Namespaced' | 'Cluster'>('all');
	let refreshing = $state(false);

	const distinctGroups = $derived(
		Array.from(new Set(data.rows.map((r) => r.group))).sort()
	);
	let groupFilter = $state<string>('all');

	const filtered = $derived(
		data.rows.filter((r) => {
			if (scopeFilter !== 'all' && r.scope !== scopeFilter) return false;
			if (groupFilter !== 'all' && r.group !== groupFilter) return false;
			if (q) {
				const hay = `${r.group}/${r.kind}/${r.name}/${r.shortNames.join(',')}`.toLowerCase();
				if (!hay.includes(q.toLowerCase())) return false;
			}
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
	<h1>CustomResourceDefinitions</h1>
	<button class="refresh" onclick={refresh} disabled={refreshing} title="Refresh">
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

{#if data.error}
	<p class="error">Failed to list CRDs: {data.error}</p>
{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by group, kind, name, shortName…" />
	<div class="kinds">
		{#each ['all', 'Namespaced', 'Cluster'] as s}
			<button class:active={scopeFilter === s} onclick={() => (scopeFilter = s as typeof scopeFilter)}>
				{s}
			</button>
		{/each}
	</div>
</div>

{#if distinctGroups.length > 1}
	<div class="controls">
		<div class="kinds groups">
			<button class:active={groupFilter === 'all'} onclick={() => (groupFilter = 'all')}>
				all groups
			</button>
			{#each distinctGroups as g}
				<button class:active={groupFilter === g} onclick={() => (groupFilter = g)} title={g}>
					{g}
				</button>
			{/each}
		</div>
	</div>
{/if}

<p class="muted small">{filtered.length} of {data.rows.length} CRDs</p>

<table>
	<thead>
		<tr>
			<th>Group</th>
			<th>Kind</th>
			<th>Version</th>
			<th>Scope</th>
			<th>Short names</th>
			<th>Age</th>
		</tr>
	</thead>
	<tbody>
		{#each filtered as r}
			<tr>
				<td class="group">{r.group}</td>
				<td class="kind"><a href="/k8s/crds/{r.name}">{r.kind}</a></td>
				<td>{r.version}</td>
				<td><span class="scope scope-{r.scope.toLowerCase()}">{r.scope}</span></td>
				<td class="short">{r.shortNames.join(', ') || '—'}</td>
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

	td.group {
		font-family: var(--font-mono);
		font-size: 0.82em;
		color: var(--muted);
	}
	td.kind a {
		color: var(--fg);
		font-weight: 500;
	}
	td.kind a:hover { color: var(--accent); }

	td.short {
		font-family: var(--font-mono);
		font-size: 0.82em;
	}

	.scope {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--bg-elev);
	}
	.scope-namespaced { color: #a5b4fc; }
	.scope-cluster { color: #c4b5fd; }

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}
</style>
