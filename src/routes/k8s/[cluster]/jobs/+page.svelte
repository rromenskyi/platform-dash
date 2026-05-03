<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import KubectlMenu from '$lib/KubectlMenu.svelte';
	import { createSort } from '$lib/sortable.svelte';
	import type { JobRow } from './+page.server';

	let { data } = $props();
	let q = $state('');

	const sort = createSort<JobRow, 'namespace' | 'name' | 'active' | 'failed' | 'started' | 'finished'>({
		keys: {
			namespace: (r) => `${r.namespace}|${r.name}`,
			name: (r) => r.name,
			active: (r) => r.active,
			failed: (r) => r.failed,
			started: (r) => Date.parse(r.startTime ?? '') || 0,
			finished: (r) => Date.parse(r.completionTime ?? '') || 0
		},
		defaultKey: 'started',
		defaultDir: 'desc',
		prefKey: 'platform-dash:jobs:sort:v1'
	});

	const filtered = $derived(
		data.rows
			.filter((r) => !q || `${r.namespace}/${r.name}`.toLowerCase().includes(q.toLowerCase()))
			.sort(sort.compare)
	);
</script>

<div class="header">
	<h1>Jobs</h1>
	<button class="ghost" onclick={() => invalidateAll()}>↻ Refresh</button>
</div>

{#if data.error}<p class="error">Failed to list Jobs: {data.error}</p>{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by name…" />
</div>

<p class="muted small">{filtered.length} of {data.rows.length}</p>

<table>
	<thead><tr>
		<th class="sortable" onclick={() => sort.toggle('namespace')}>Namespace<span class="arr">{sort.indicator('namespace')}</span></th>
		<th class="sortable" onclick={() => sort.toggle('name')}>Name<span class="arr">{sort.indicator('name')}</span></th>
		<th>Completions</th>
		<th class="num sortable" onclick={() => sort.toggle('active')}>Active<span class="arr">{sort.indicator('active')}</span></th>
		<th class="num sortable" onclick={() => sort.toggle('failed')}>Failed<span class="arr">{sort.indicator('failed')}</span></th>
		<th class="sortable" onclick={() => sort.toggle('started')}>Started<span class="arr">{sort.indicator('started')}</span></th>
		<th class="sortable" onclick={() => sort.toggle('finished')}>Finished<span class="arr">{sort.indicator('finished')}</span></th>
		<th>Actions</th>
	</tr></thead>
	<tbody>
		{#each filtered as r}
			<tr class:bad={r.failed > 0} class:active={r.active > 0}>
				<td>{r.namespace}</td>
				<td class="mono">{r.name}</td>
				<td>{r.completions}</td>
				<td class="num">{r.active || ''}</td>
				<td class="num" class:bad-cell={r.failed > 0}>{r.failed || ''}</td>
				<td>{age(r.startTime)}</td>
				<td>{r.completionTime ? age(r.completionTime) : '—'}</td>
				<td><KubectlMenu target={{ cluster: data.cluster, kind: 'Job', namespace: r.namespace, name: r.name }} /></td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.ghost { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover { color: var(--fg); border-color: var(--muted); }
	.controls { margin: 1rem 0 0.5rem; }
	.search { width: 100%; max-width: 320px; padding: 0.5rem 0.8rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px; color: var(--fg); font: inherit; }
	.search:focus { outline: none; border-color: var(--accent); }
	.small { font-size: 0.85rem; margin: 0.5rem 0 1rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
	th { text-align: left; padding: 0.5rem 0.75rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	tr:hover td { background: var(--bg-elev); }
	tr.bad td { color: #fb7185; }
	td.bad-cell { color: #fb7185; font-weight: 500; }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	.error { padding: 0.75rem 1rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 8px; color: #fb7185; }
	th.sortable { cursor: pointer; user-select: none; }
	th.sortable:hover { color: var(--fg); }
	th .arr { display: inline-block; margin-left: 0.3rem; color: var(--accent); font-size: 0.85em; min-width: 0.6em; }
</style>
