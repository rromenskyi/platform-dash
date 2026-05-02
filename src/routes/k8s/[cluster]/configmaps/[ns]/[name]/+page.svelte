<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import { stringify as toYaml } from 'yaml';
	import { page } from '$app/state';
	import { toast } from '$lib/toast.svelte';
	import { lineDiff, diffStats } from '$lib/line-diff';

	let { data } = $props();
	const entries = $derived(Object.entries(data.data));

	const canWrite = $derived(!!page.data.canWrite);

	let format = $state<'yaml' | 'json'>('yaml');
	let editing = $state(false);
	let editBuffer = $state('');
	let saving = $state(false);
	let showDiff = $state(false);

	const yaml = $derived(data.object ? toYaml(data.object, { sortMapEntries: false }) : '');
	const json = $derived(data.object ? JSON.stringify(data.object, null, 2) : '');
	const body = $derived(format === 'yaml' ? yaml : json);

	const diffOps = $derived.by(() => {
		if (!editing || !showDiff) return [];
		return lineDiff(body, editBuffer);
	});
	const diffSummary = $derived(diffStats(diffOps));

	function startEdit() {
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
			const res = await fetch(`/k8s/${data.cluster}/api/cm-replace`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					namespace: data.ns,
					name: data.name,
					body: editBuffer
				})
			});
			if (!res.ok) {
				const text = await res.text();
				toast.show(`replace failed (${res.status}): ${text || res.statusText}`, 'err');
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
</script>

<p class="crumb"><a href="/k8s/{data.cluster}/configmaps">← ConfigMaps</a></p>

<div class="header">
	<div>
		<h1>{data.name}</h1>
		<p class="muted small">ns <code>{data.ns}</code> · age {age(data.creationTimestamp)} · {entries.length} key{entries.length === 1 ? '' : 's'}{#if data.binaryDataKeys.length > 0} + {data.binaryDataKeys.length} binary{/if}</p>
	</div>
	<div class="actions">
		<div class="fmt">
			<button class:active={format === 'yaml'} onclick={() => (format = 'yaml')}>YAML</button>
			<button class:active={format === 'json'} onclick={() => (format = 'json')}>JSON</button>
		</div>
		{#if canWrite}
			{#if !editing}
				<button class="ghost" onclick={startEdit} disabled={!body}>edit</button>
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

{#if editing}
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
{:else}
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
{/if}

{#if data.scopedAudit.length > 0}
	<section class="audit-card">
		<h2>Recent actions <span class="muted small">(audit ring)</span></h2>
		<table>
			<thead>
				<tr><th>When</th><th>User</th><th>Action</th><th>Outcome</th><th class="num">ms</th><th>Message</th></tr>
			</thead>
			<tbody>
				{#each data.scopedAudit as a}
					<tr>
						<td class="ts">{age(a.ts)}</td>
						<td class="mono">{a.user}</td>
						<td class="mono">{a.action}</td>
						<td><span class="outcome outcome-{a.outcome}">{a.outcome}</span></td>
						<td class="num">{a.durationMs ?? ''}</td>
						<td class="msg">{a.message ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<style>
	.crumb { font-size: 0.85rem; margin: 0 0 1rem; }
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.header h1 { margin: 0; }
	.small { font-size: 0.85rem; }
	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }

	.actions { display: inline-flex; gap: 0.4rem; align-items: center; }
	.fmt { display: inline-flex; gap: 0.15rem; border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
	.fmt button { font: inherit; font-size: 0.78rem; padding: 0.3rem 0.7rem; border: none; background: transparent; color: var(--fg-soft); cursor: pointer; }
	.fmt button.active { background: var(--bg-elev); color: var(--accent); }
	.ghost { font: inherit; font-size: 0.78rem; padding: 0.35rem 0.7rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--accent); }
	.ghost:disabled { cursor: wait; opacity: 0.5; }

	.kv-card { margin-top: 1rem; padding: 0.85rem 1rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg-elev); }
	.kv-card h3 { margin: 0 0 0.5rem; font-size: 0.85rem; font-family: var(--font-mono); color: var(--accent); }
	.kv-card pre { margin: 0; padding: 0.6rem 0.8rem; background: #0a0c10; color: #e2e8f0; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; overflow: auto; max-height: 400px; white-space: pre-wrap; word-break: break-all; }

	.editor {
		width: 100%;
		min-height: 60vh;
		padding: 0.75rem;
		font: 0.82rem var(--font-mono);
		background: #0a0c10;
		color: #e2e8f0;
		border: 1px solid var(--rule);
		border-radius: 8px;
		resize: vertical;
		white-space: pre;
		tab-size: 2;
	}
	.editor:focus { outline: none; border-color: var(--accent); }

	.diff-head { display: inline-flex; gap: 0.6rem; align-items: center; margin: 1rem 0 0.4rem; }
	.diff-stat { font-family: var(--font-mono); font-size: 0.78rem; padding: 0.05rem 0.4rem; border-radius: 3px; border: 1px solid var(--rule); }
	.diff-stat.add { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.diff-stat.del { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }
	.diff { margin: 0; padding: 0.6rem 0.8rem; background: #0a0c10; border-radius: 6px; font-family: var(--font-mono); font-size: 0.78rem; line-height: 1.45; overflow: auto; max-height: 480px; white-space: pre; tab-size: 2; }
	.diff .op { display: block; padding: 0 0.3rem; }
	.diff .op-same { color: #94a3b8; }
	.diff .op-add { color: #6ee7b7; background: rgba(110, 231, 183, 0.08); }
	.diff .op-del { color: #fb7185; background: rgba(251, 113, 133, 0.08); }

	.audit-card { margin-top: 1.5rem; padding: 0.85rem 1rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg-elev); }
	.audit-card h2 { margin: 0 0 0.5rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
	th { text-align: left; padding: 0.35rem 0.55rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.4rem 0.55rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: top; }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.92em; }
	td.ts { color: var(--muted); white-space: nowrap; font-family: var(--font-mono); font-size: 0.85em; }
	td.msg { color: var(--muted); font-family: var(--font-mono); font-size: 0.85em; max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.outcome { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 3px; font-family: var(--font-mono); font-size: 0.78em; border: 1px solid var(--rule); color: var(--fg-soft); }
	.outcome-ok { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.outcome-denied { color: #fcd34d; border-color: rgba(252, 211, 77, 0.4); }
	.outcome-error { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }
</style>
