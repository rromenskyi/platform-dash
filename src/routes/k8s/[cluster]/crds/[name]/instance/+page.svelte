<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { stringify as toYaml } from 'yaml';

	let { data } = $props();

	let refreshing = $state(false);
	let copied = $state(false);
	let format = $state<'yaml' | 'json'>('yaml');

	const yaml = $derived(data.object ? toYaml(data.object, { sortMapEntries: false }) : '');
	const json = $derived(data.object ? JSON.stringify(data.object, null, 2) : '');
	const body = $derived(format === 'yaml' ? yaml : json);

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	async function copy() {
		if (!body) return;
		try {
			await navigator.clipboard.writeText(body);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.error('clipboard write failed', err);
		}
	}
</script>

<p class="crumb">
	<a href="/k8s/{data.cluster}/crds">CustomResourceDefinitions</a> /
	<a href="/k8s/{data.cluster}/crds/{data.crd.name}">{data.crd.kind}</a> /
	<span>{data.instance.namespace ? `${data.instance.namespace}/` : ''}{data.instance.name}</span>
</p>

<div class="header">
	<div>
		<h1>{data.instance.name}</h1>
		<p class="muted small">
			<code>{data.crd.kind}</code>
			{#if data.instance.namespace}· ns <code>{data.instance.namespace}</code>{/if}
			· <code>{data.crd.group}/{data.crd.servingVersion}</code>
		</p>
	</div>
	<div class="actions">
		<div class="fmt">
			<button class:active={format === 'yaml'} onclick={() => (format = 'yaml')}>YAML</button>
			<button class:active={format === 'json'} onclick={() => (format = 'json')}>JSON</button>
		</div>
		<button class="ghost" onclick={copy} disabled={!body} title="Copy {format.toUpperCase()}">
			{copied ? '✓ copied' : 'Copy'}
		</button>
		<button class="ghost" onclick={refresh} disabled={refreshing} title="Refresh">
			<span class:spin={refreshing}>↻</span> Refresh
		</button>
	</div>
</div>

{#if data.fetchError}
	<p class="error">Failed to fetch object: {data.fetchError}</p>
{:else if body}
	<pre class="yaml">{body}</pre>
{:else}
	<p class="muted small">No object data.</p>
{/if}

<style>
	.crumb {
		font-size: 0.85rem;
		margin: 0 0 1rem;
	}
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }
	.crumb span { color: var(--fg); }

	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.header h1 { margin: 0; }
	.header .small { margin-top: 0.25rem; }

	.actions { display: flex; gap: 0.5rem; align-items: center; }
	.fmt {
		display: inline-flex;
		border: 1px solid var(--rule);
		border-radius: 6px;
		overflow: hidden;
	}
	.fmt button {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.35rem 0.7rem;
		background: transparent;
		border: 0;
		color: var(--fg-soft);
		cursor: pointer;
	}
	.fmt button:hover { color: var(--fg); background: var(--bg); }
	.fmt button.active { background: var(--bg-elev); color: var(--accent); }

	.ghost {
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
	.ghost:hover:not(:disabled) {
		color: var(--fg);
		border-color: var(--muted);
	}
	.ghost:disabled { cursor: not-allowed; opacity: 0.5; }
	.spin {
		display: inline-block;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.small { font-size: 0.85rem; }

	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		color: var(--fg);
	}

	.yaml {
		margin-top: 1rem;
		padding: 1rem 1.25rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
		color: var(--fg);
		font-family: var(--font-mono);
		font-size: 0.82rem;
		line-height: 1.55;
		overflow: auto;
		max-height: calc(100vh - 220px);
		white-space: pre;
	}

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}
</style>
