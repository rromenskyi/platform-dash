<script lang="ts">
	import { age } from '$lib/k8s';
	let { data } = $props();
	const entries = $derived(Object.entries(data.data));
	let revealed = $state<Record<string, boolean>>({});
	function toggle(k: string) { revealed = { ...revealed, [k]: !revealed[k] }; }
	function copy(v: string) { navigator.clipboard?.writeText(v).catch(() => {}); }
</script>

<p class="crumb"><a href="/k8s/{data.cluster}/secrets">← Secrets</a></p>

<div class="header">
	<div>
		<h1>{data.name}</h1>
		<p class="muted small">ns <code>{data.ns}</code> · type <code>{data.type}</code> · age {age(data.creationTimestamp)} · {entries.length} key{entries.length === 1 ? '' : 's'}</p>
	</div>
</div>

{#if entries.length === 0}
	<p class="muted">No data.</p>
{/if}

{#each entries as [k, v]}
	<section class="kv-card">
		<header>
			<h3>{k}</h3>
			<div class="acts">
				<button class="ghost" onclick={() => toggle(k)}>{revealed[k] ? 'hide' : 'reveal'}</button>
				<button class="ghost" onclick={() => copy(v)} title="Copy decoded value">copy</button>
			</div>
		</header>
		{#if revealed[k]}
			<pre>{v}</pre>
		{:else}
			<pre class="masked">{'•'.repeat(Math.min(v.length, 32))}</pre>
		{/if}
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
	.kv-card header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
	.kv-card h3 { margin: 0; font-size: 0.85rem; font-family: var(--font-mono); color: var(--accent); }
	.acts { display: inline-flex; gap: 0.3rem; }
	.ghost { font: inherit; font-size: 0.75rem; padding: 0.2rem 0.55rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 4px; cursor: pointer; }
	.ghost:hover { color: var(--fg); border-color: var(--accent); }
	pre { margin: 0; padding: 0.6rem 0.8rem; background: #0a0c10; color: #e2e8f0; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; overflow: auto; max-height: 400px; white-space: pre-wrap; word-break: break-all; }
	pre.masked { color: var(--muted); }
</style>
