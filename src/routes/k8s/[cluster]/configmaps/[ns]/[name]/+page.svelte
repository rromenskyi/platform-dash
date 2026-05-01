<script lang="ts">
	import { age } from '$lib/k8s';
	let { data } = $props();
	const entries = $derived(Object.entries(data.data));
</script>

<p class="crumb"><a href="/k8s/{data.cluster}/configmaps">← ConfigMaps</a></p>

<div class="header">
	<div>
		<h1>{data.name}</h1>
		<p class="muted small">ns <code>{data.ns}</code> · age {age(data.creationTimestamp)} · {entries.length} key{entries.length === 1 ? '' : 's'}{#if data.binaryDataKeys.length > 0} + {data.binaryDataKeys.length} binary{/if}</p>
	</div>
</div>

{#if entries.length === 0 && data.binaryDataKeys.length === 0}
	<p class="muted">No data.</p>
{/if}

{#each entries as [k, v]}
	<section class="kv-card">
		<h3>{k}</h3>
		<pre>{v}</pre>
	</section>
{/each}

{#each data.binaryDataKeys as k}
	<section class="kv-card">
		<h3>{k} <span class="muted small">(binary)</span></h3>
		<p class="muted small">Binary value not displayed.</p>
	</section>
{/each}

<style>
	.crumb { font-size: 0.85rem; margin: 0 0 1rem; }
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.header h1 { margin: 0; }
	.small { font-size: 0.85rem; }
	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }
	.kv-card { margin-top: 1rem; padding: 0.85rem 1rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg-elev); }
	.kv-card h3 { margin: 0 0 0.5rem; font-size: 0.85rem; font-family: var(--font-mono); color: var(--accent); }
	.kv-card pre { margin: 0; padding: 0.6rem 0.8rem; background: #0a0c10; color: #e2e8f0; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; overflow: auto; max-height: 400px; white-space: pre-wrap; word-break: break-all; }
</style>
