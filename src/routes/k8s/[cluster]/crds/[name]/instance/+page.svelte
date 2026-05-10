<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { stringify as toYaml } from 'yaml';
	import { page } from '$app/state';
	import { toast } from '$lib/toast.svelte';
	import { lineDiff, diffStats } from '$lib/line-diff';
	import { confirm as confirmDialog } from '$lib/confirm.svelte';

	let { data } = $props();

	let refreshing = $state(false);
	let copied = $state(false);
	let format = $state<'yaml' | 'json'>('yaml');

	let editing = $state(false);
	let editBuffer = $state('');
	let saving = $state(false);
	let showDiff = $state(false);

	const canWrite = $derived(!!page.data.canWrite);

	const yaml = $derived(data.object ? toYaml(data.object, { sortMapEntries: false }) : '');
	const json = $derived(data.object ? JSON.stringify(data.object, null, 2) : '');
	const body = $derived(format === 'yaml' ? yaml : json);

	// Diff vs. the original object the page was loaded with. Computed
	// only when the diff panel is open so editing typing latency stays
	// snappy on long objects.
	const diffOps = $derived.by(() => {
		if (!editing || !showDiff) return [];
		return lineDiff(body, editBuffer);
	});
	const diffSummary = $derived(diffStats(diffOps));

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

	function startEdit() {
		// Seed the editor from whatever the user is currently viewing
		// — they probably picked YAML/JSON for a reason. Resource version
		// stays in the body so the API rejects concurrent edits.
		editBuffer = body;
		editing = true;
	}
	function cancelEdit() {
		editing = false;
		editBuffer = '';
	}
	async function saveEdit() {
		if (saving) return;
		saving = true;
		try {
			const res = await fetch(`/k8s/${data.cluster}/api/crd-replace`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					crdName: data.crd.name,
					namespace: data.instance.namespace,
					name: data.instance.name,
					body: editBuffer
				})
			});
			if (!res.ok) {
				toast.show(`replace failed (${res.status}): ${await unwrapErr(res)}`, 'err');
				return;
			}
			toast.show('saved');
			editing = false;
			await invalidateAll();
		} catch (err) {
			toast.show(`replace failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
		} finally {
			saving = false;
		}
	}
	async function deleteInstance() {
		const proceed = await confirmDialog({
			title: `Delete ${data.crd.kind}?`,
			body: `${data.instance.namespace ? data.instance.namespace + '/' : ''}${data.instance.name}\n\nThis is non-recoverable; finalisers may delay the actual deletion.`,
			confirm: 'Delete',
			danger: true
		});
		if (!proceed) return;
		try {
			const res = await fetch(`/k8s/${data.cluster}/api/crd-delete`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					crdName: data.crd.name,
					namespace: data.instance.namespace,
					name: data.instance.name
				})
			});
			if (!res.ok) {
				toast.show(`delete failed (${res.status}): ${await unwrapErr(res)}`, 'err');
				return;
			}
			await goto(`/k8s/${data.cluster}/crds/${data.crd.name}`);
		} catch (err) {
			toast.show(`delete failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
		}
	}

	// SvelteKit's error() helper responds with JSON {message: "..."}.
	// Strip the envelope so the toast shows just the apiserver line,
	// not raw JSON. Falls back to text + statusText if the body isn't
	// JSON.
	async function unwrapErr(res: Response): Promise<string> {
		const raw = await res.text();
		if (!raw) return res.statusText;
		try {
			const parsed = JSON.parse(raw) as { message?: string };
			return parsed.message ?? raw;
		} catch {
			return raw;
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
		<button class="ghost" onclick={copy} disabled={!body || editing} title="Copy {format.toUpperCase()}">
			{copied ? '✓ copied' : 'Copy'}
		</button>
		<button class="ghost" onclick={refresh} disabled={refreshing || editing} title="Refresh">
			<span class:spin={refreshing}>↻</span> Refresh
		</button>
		{#if canWrite}
			{#if !editing}
				<button class="ghost" onclick={startEdit} disabled={!body}>edit</button>
				<button class="ghost danger" onclick={deleteInstance} disabled={!body}>delete</button>
			{:else}
				<button class="ghost" onclick={() => (showDiff = !showDiff)} disabled={saving}>
					{showDiff ? 'hide diff' : 'show diff'}
				</button>
				<button class="ghost" onclick={saveEdit} disabled={saving}>{saving ? 'saving…' : 'save'}</button>
				<button class="ghost" onclick={cancelEdit} disabled={saving}>cancel</button>
			{/if}
		{/if}
	</div>
</div>

{#if data.fetchError}
	<p class="error">Failed to fetch object: {data.fetchError}</p>
{:else if editing}
	<textarea class="editor" bind:value={editBuffer} spellcheck="false"></textarea>
	<p class="muted small">YAML or JSON accepted. metadata.resourceVersion is preserved — concurrent edits get a 409.</p>
	{#if showDiff}
		<div class="diff-head">
			<span class="diff-stat add">+{diffSummary.added}</span>
			<span class="diff-stat del">−{diffSummary.removed}</span>
			<span class="muted small">vs. loaded {format.toUpperCase()}</span>
		</div>
		<pre class="diff">{#each diffOps as op}<span class="op op-{op.kind}">{op.kind === 'add' ? '+' : op.kind === 'del' ? '-' : ' '} {op.line}</span>{/each}</pre>
	{/if}
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
	.ghost.danger:hover { color: #fb7185; border-color: #fb7185; }

	.editor {
		margin-top: 1rem;
		width: 100%;
		min-height: calc(100vh - 280px);
		padding: 0.85rem 1rem;
		background: #0a0c10;
		color: #e2e8f0;
		border: 1px solid var(--rule);
		border-radius: 8px;
		font-family: var(--font-mono);
		font-size: 0.82rem;
		line-height: 1.55;
		resize: vertical;
		white-space: pre;
		tab-size: 2;
	}
	.editor:focus { outline: none; border-color: var(--accent); }

	.diff-head {
		display: inline-flex;
		gap: 0.6rem;
		align-items: center;
		margin: 1rem 0 0.4rem;
	}
	.diff-stat {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		padding: 0.05rem 0.4rem;
		border-radius: 3px;
		border: 1px solid var(--rule);
	}
	.diff-stat.add { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.diff-stat.del { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }
	.diff {
		margin: 0;
		padding: 0.6rem 0.8rem;
		background: #0a0c10;
		border-radius: 6px;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.45;
		overflow: auto;
		max-height: 480px;
		white-space: pre;
		tab-size: 2;
	}
	.diff .op {
		display: block;
		padding: 0 0.3rem;
	}
	.diff .op-same { color: #94a3b8; }
	.diff .op-add { color: #6ee7b7; background: rgba(110, 231, 183, 0.08); }
	.diff .op-del { color: #fb7185; background: rgba(251, 113, 133, 0.08); }
</style>
