<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { createLiveList } from '$lib/live-list.svelte';
	import type { SvcRow } from './+page.server';

	let { data } = $props();
	let q = $state('');
	let typeFilter = $state<'all' | 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName'>('all');

	const live = createLiveList<SvcRow>({
		initial: [],
		url: () => {
			const ns = page.url.searchParams.get('ns') || '';
			const u = `/k8s/${data.cluster}/api/watch/services`;
			return ns ? `${u}?ns=${encodeURIComponent(ns)}` : u;
		},
		keyFn: (r) => `${r.namespace}|${r.name}`,
		sortFn: (a, b) => {
			if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
			return a.name.localeCompare(b.name);
		}
	});
	$effect(() => { live.reseed(data.rows); });
	$effect(() => { const _ns = page.url.searchParams.get('ns'); void _ns; live.sync(); });
	onDestroy(() => live.destroy());

	const filtered = $derived(
		live.rows.filter((r) => {
			if (typeFilter !== 'all' && r.type !== typeFilter) return false;
			if (q && !`${r.namespace}/${r.name}`.toLowerCase().includes(q.toLowerCase())) return false;
			return true;
		})
	);
</script>

<div class="header">
	<h1>Services</h1>
	<div class="head-actions">
		<label class="live-toggle"><input type="checkbox" bind:checked={live.live} /><span class="dot {live.live ? 'on' : 'off'}"></span> Live</label>
		<button class="ghost" onclick={() => invalidateAll()} disabled={live.live}>↻ Refresh</button>
	</div>
</div>

{#if data.error}<p class="error">Failed to list Services: {data.error}</p>{/if}
{#if live.error}<p class="error">{live.error}</p>{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by name…" />
	<div class="kinds">
		{#each ['all', 'ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'] as t}
			<button class:active={typeFilter === t} onclick={() => (typeFilter = t as typeof typeFilter)}>{t}</button>
		{/each}
	</div>
</div>

<p class="muted small">{filtered.length} of {live.rows.length}</p>

<table>
	<thead><tr><th>Namespace</th><th>Name</th><th>Type</th><th>ClusterIP</th><th>External</th><th>Ports</th><th>Age</th></tr></thead>
	<tbody>
		{#each filtered as r}
			<tr>
				<td>{r.namespace}</td>
				<td class="mono">{r.name}</td>
				<td><span class="type type-{r.type.toLowerCase()}">{r.type}</span></td>
				<td class="mono small">{r.clusterIP}</td>
				<td class="mono small">{r.externalIP}</td>
				<td class="mono small">{r.ports}</td>
				<td>{age(r.creationTimestamp)}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.head-actions { display: inline-flex; gap: 0.5rem; align-items: center; }
	.live-toggle { display: inline-flex; gap: 0.4rem; align-items: center; font-size: 0.85rem; color: var(--fg-soft); padding: 0.4rem 0.75rem; border: 1px solid var(--rule); border-radius: 6px; cursor: pointer; }
	.live-toggle input { accent-color: var(--accent); }
	.dot { width: 8px; height: 8px; border-radius: 50%; }
	.dot.on { background: #6ee7b7; box-shadow: 0 0 6px #6ee7b7; }
	.dot.off { background: var(--muted); }
	.ghost { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.ghost:disabled { cursor: not-allowed; opacity: 0.5; }
	.controls { display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0 0.5rem; flex-wrap: wrap; }
	.search { flex: 1 1 240px; padding: 0.5rem 0.8rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px; color: var(--fg); font: inherit; }
	.search:focus { outline: none; border-color: var(--accent); }
	.kinds { display: flex; gap: 0.25rem; flex-wrap: wrap; }
	.kinds button { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.kinds button:hover { color: var(--fg); border-color: var(--muted); }
	.kinds button.active { background: var(--bg-elev); color: var(--accent); border-color: var(--accent); }
	.small { font-size: 0.85rem; margin: 0.5rem 0 1rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
	th { text-align: left; padding: 0.5rem 0.75rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
	td { padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	tr:hover td { background: var(--bg-elev); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.small { font-size: 0.78em; }
	.type { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 4px; font-size: 0.7rem; background: var(--bg-elev); }
	.type-clusterip { color: var(--muted); }
	.type-nodeport { color: #fcd34d; }
	.type-loadbalancer { color: #6ee7b7; }
	.type-externalname { color: #a5b4fc; }
	.error { padding: 0.75rem 1rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 8px; color: #fb7185; }
</style>
