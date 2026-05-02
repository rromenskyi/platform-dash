<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll, goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { createLiveList } from '$lib/live-list.svelte';
	import type { IngressRow } from './+page.server';
	import KubectlMenu from '$lib/KubectlMenu.svelte';
	import LiveDot from '$lib/LiveDot.svelte';
	import { createKbdNav } from '$lib/kbd-nav.svelte';
	import Highlight from '$lib/Highlight.svelte';

	let { data } = $props();

	const Q_KEY = 'platform-dash:ingresses:q';
	let q = $state(typeof localStorage === 'undefined' ? '' : (localStorage.getItem(Q_KEY) ?? ''));
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(Q_KEY, q);
		} catch {
			/* */
		}
	});

	const live = createLiveList<IngressRow>({
		initial: [],
		url: () => {
			const ns = page.url.searchParams.get('ns') || '';
			const u = `/k8s/${data.cluster}/api/watch/ingresses`;
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
		live.rows.filter(
			(r) =>
				!q ||
				`${r.namespace}/${r.name} ${r.hosts.join(' ')}`.toLowerCase().includes(q.toLowerCase())
		)
	);

	const kbd = createKbdNav({
		rowCount: () => filtered.length,
		onEnter: (i) => {
			const r = filtered[i];
			if (r) goto(`/k8s/${data.cluster}/ingresses/${r.namespace}/${r.name}`);
		}
	});
	$effect(() => kbd.attach());
</script>

<div class="header">
	<h1>Ingresses</h1>
	<div class="head-actions">
		<label class="live-toggle"><input type="checkbox" bind:checked={live.live} /><LiveDot state={live.streamState} /> Live</label>
		<button class="ghost" onclick={() => invalidateAll()} disabled={live.live}>↻ Refresh</button>
	</div>
</div>

{#if data.error}<p class="error">Failed to list Ingresses: {data.error}</p>{/if}
{#if live.error}<p class="error">{live.error}</p>{/if}

<div class="controls">
	<input class="search" type="search" bind:value={q} placeholder="Filter by host or name…" />
</div>

<p class="muted small">{filtered.length} of {live.rows.length}</p>

<table>
	<thead><tr><th>Namespace</th><th>Name</th><th>Class</th><th>Hosts → Backend</th><th>TLS</th><th>Age</th><th>Actions</th></tr></thead>
	<tbody>
		{#each filtered as r, i}
			<tr class:row-focused={i === kbd.focusedIdx}>
				<td><Highlight text={r.namespace} {q} /></td>
				<td class="mono"><a href="/k8s/{data.cluster}/ingresses/{r.namespace}/{r.name}"><Highlight text={r.name} {q} /></a></td>
				<td class="mono small">{r.className ?? '—'}</td>
				<td class="rules">
					{#each r.rules as rule}
						<div class="rule">
							<a class="host" href="https://{rule.host}{rule.path}" rel="noopener" target="_blank">{rule.host ?? '*'}{rule.path}</a>
							→ <code>{rule.service}:{rule.port}</code>
						</div>
					{/each}
					{#if r.rules.length === 0}<span class="muted">—</span>{/if}
				</td>
				<td class="mono small">{r.tlsHosts.join(', ') || '—'}</td>
				<td>{age(r.creationTimestamp)}</td>
				<td><KubectlMenu target={{ cluster: data.cluster, kind: 'Ingress', namespace: r.namespace, name: r.name }} /></td>
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
	.controls { margin: 1rem 0 0.5rem; }
	.search { width: 100%; max-width: 320px; padding: 0.5rem 0.8rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px; color: var(--fg); font: inherit; }
	.search:focus { outline: none; border-color: var(--accent); }
	.small { font-size: 0.85rem; margin: 0.5rem 0 1rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
	th { text-align: left; padding: 0.5rem 0.75rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
	td { padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: top; }
	tr:hover td { background: var(--bg-elev); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.small { font-size: 0.78em; }
	.rules { font-size: 0.82rem; }
	.rule { padding: 0.1rem 0; }
	.host { color: var(--accent); font-family: var(--font-mono); font-size: 0.85em; }
	.host:hover { text-decoration: underline; }
	code { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	.error { padding: 0.75rem 1rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 8px; color: #fb7185; }
	tr.row-focused td { box-shadow: inset 2px 0 0 var(--accent); }
</style>
