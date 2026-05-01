<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { createLiveList } from '$lib/live-list.svelte';
	import type { NamespaceRow } from './+page.server';

	let { data } = $props();
	let q = $state('');

	const live = createLiveList<NamespaceRow>({
		initial: [],
		// Namespaces are cluster-scoped — ?ns= is irrelevant.
		url: () => `/k8s/${data.cluster}/api/watch/namespaces`,
		keyFn: (r) => r.name,
		sortFn: (a, b) => a.name.localeCompare(b.name)
	});
	$effect(() => { live.reseed(data.rows); });
	$effect(() => { live.sync(); });
	onDestroy(() => live.destroy());

	const filtered = $derived(
		live.rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))
	);
</script>

<div class="header">
	<h1>Namespaces</h1>
	<div class="head-actions">
		<label class="live-toggle"><input type="checkbox" bind:checked={live.live} /><span class="dot {live.live ? 'on' : 'off'}"></span> Live</label>
		<button class="ghost" onclick={() => invalidateAll()} disabled={live.live}>↻ Refresh</button>
	</div>
</div>

{#if data.error}<p class="error">Failed to list namespaces: {data.error}</p>{/if}
{#if live.error}<p class="error">{live.error}</p>{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by name…" />
</div>

<p class="muted small">{filtered.length} of {live.rows.length} namespaces</p>

<table>
	<thead>
		<tr>
			<th>Name</th>
			<th>Phase</th>
			<th>Labels</th>
			<th>Age</th>
			<th>Actions</th>
		</tr>
	</thead>
	<tbody>
		{#each filtered as n}
			<tr>
				<td class="mono"><a href="/k8s/{data.cluster}/workloads?ns={encodeURIComponent(n.name)}">{n.name}</a></td>
				<td><span class="phase phase-{n.phase.toLowerCase()}">{n.phase}</span></td>
				<td class="labels">
					{#each Object.entries(n.labels).slice(0, 3) as [k, v]}
						<span class="lbl">{k}={v}</span>
					{/each}
					{#if Object.keys(n.labels).length > 3}<span class="muted">+{Object.keys(n.labels).length - 3}</span>{/if}
				</td>
				<td>{age(n.creationTimestamp)}</td>
				<td>
					<a class="act" href="/k8s/{data.cluster}/workloads?ns={encodeURIComponent(n.name)}">workloads</a>
					<a class="act" href="/k8s/{data.cluster}/configmaps?ns={encodeURIComponent(n.name)}">cm</a>
					<a class="act" href="/k8s/{data.cluster}/secrets?ns={encodeURIComponent(n.name)}">secrets</a>
				</td>
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
	.ghost {
		font: inherit; font-size: 0.85rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
	}
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.ghost:disabled { cursor: not-allowed; opacity: 0.5; }

	.controls { margin: 1rem 0 0.5rem; }
	.search {
		width: 100%; max-width: 320px;
		padding: 0.5rem 0.8rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
		color: var(--fg);
		font: inherit;
	}
	.search:focus { outline: none; border-color: var(--accent); }
	.small { font-size: 0.85rem; margin: 0.5rem 0 1rem; }

	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
	th { text-align: left; padding: 0.5rem 0.75rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
	td { padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	tr:hover td { background: var(--bg-elev); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.mono a { color: var(--fg); }
	td.mono a:hover { color: var(--accent); }

	.phase { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 4px; font-size: 0.7rem; background: var(--bg-elev); }
	.phase-active { color: #6ee7b7; }
	.phase-terminating { color: #fcd34d; }

	.labels { font-size: 0.78rem; }
	.lbl { display: inline-block; padding: 0.05rem 0.4rem; margin-right: 0.25rem; background: var(--bg-elev); border-radius: 3px; color: var(--fg-soft); font-family: var(--font-mono); font-size: 0.85em; }

	.act {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--rule);
		border-radius: 4px;
		color: var(--fg-soft);
		margin-right: 0.25rem;
	}
	.act:hover { color: var(--accent); border-color: var(--accent); }

	.error { padding: 0.75rem 1rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 8px; color: #fb7185; }
</style>
