<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import KubectlMenu from '$lib/KubectlMenu.svelte';
	let { data } = $props();
	let q = $state('');
	const filtered = $derived(
		data.rows.filter((r) => !q || `${r.namespace}/${r.name}`.toLowerCase().includes(q.toLowerCase()))
	);
</script>

<div class="header">
	<h1>CronJobs</h1>
	<button class="ghost" onclick={() => invalidateAll()}>↻ Refresh</button>
</div>

{#if data.error}<p class="error">Failed to list CronJobs: {data.error}</p>{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by name…" />
</div>

<p class="muted small">{filtered.length} of {data.rows.length}</p>

<table>
	<thead><tr><th>Namespace</th><th>Name</th><th>Schedule</th><th>Suspended</th><th class="num">Active</th><th>Last run</th><th>Age</th><th>Actions</th></tr></thead>
	<tbody>
		{#each filtered as r}
			<tr class:suspended={r.suspend}>
				<td>{r.namespace}</td>
				<td class="mono">{r.name}</td>
				<td class="mono small">{r.schedule}</td>
				<td>{r.suspend ? 'yes' : ''}</td>
				<td class="num">{r.active || ''}</td>
				<td>{r.lastSchedule ? age(r.lastSchedule) : '—'}</td>
				<td>{age(r.creationTimestamp)}</td>
				<td><KubectlMenu target={{ cluster: data.cluster, kind: 'CronJob', namespace: r.namespace, name: r.name }} /></td>
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
	td.small { font-size: 0.78em; }
	tr:hover td { background: var(--bg-elev); }
	tr.suspended td { opacity: 0.55; }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	.error { padding: 0.75rem 1rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 8px; color: #fb7185; }
</style>
