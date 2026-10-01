<script lang="ts">
	import { age } from '$lib/k8s';
	import { toast } from '$lib/toast.svelte';
	let { data } = $props();

	type RevealState = { value: string; masked: boolean } | { error: string } | null;
	let revealed = $state<Record<string, RevealState>>({});
	let pending = $state<Record<string, boolean>>({});

	async function toggle(k: string) {
		// Second click hides — drops the cached value so a re-reveal
		// re-fetches (and re-audits, which is the point).
		if (revealed[k]) {
			revealed = { ...revealed, [k]: null };
			return;
		}
		pending = { ...pending, [k]: true };
		try {
			const res = await fetch(`/k8s/${data.cluster}/api/secret-reveal`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ namespace: data.ns, name: data.name, key: k })
			});
			if (!res.ok) {
				const text = await res.text();
				revealed = { ...revealed, [k]: { error: text || res.statusText } };
				toast.show(`reveal ${k} failed: ${text || res.statusText}`, 'err');
				return;
			}
			const j = (await res.json()) as { value: string; masked: boolean };
			revealed = { ...revealed, [k]: { value: j.value, masked: j.masked } };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			revealed = { ...revealed, [k]: { error: msg } };
			toast.show(`reveal ${k} failed: ${msg}`, 'err');
		} finally {
			pending = { ...pending, [k]: false };
		}
	}

	async function copy(k: string) {
		const r = revealed[k];
		if (!r || 'error' in r) return;
		try {
			await navigator.clipboard.writeText(r.value);
			toast.show('copied');
		} catch {
			toast.show('clipboard write failed', 'err');
		}
	}

	// `revealed[key]` is undefined until the first toggle — `'error' in
	// undefined` would throw, so treat it like null (hidden).
	function isShown(s: RevealState | undefined): s is { value: string; masked: boolean } {
		return s != null && !('error' in s);
	}
	function isError(s: RevealState | undefined): s is { error: string } {
		return s != null && 'error' in s;
	}
</script>

<p class="crumb"><a href="/k8s/{data.cluster}/secrets">← Secrets</a></p>

<div class="header">
	<div>
		<h1>{data.name}</h1>
		<p class="muted small">ns <code>{data.ns}</code> · type <code>{data.type}</code> · age {age(data.creationTimestamp)} · {data.keys.length} key{data.keys.length === 1 ? '' : 's'}</p>
	</div>
</div>

{#if data.keys.length === 0}
	<p class="muted">No data.</p>
{/if}

{#each data.keys as { key, len }}
	{@const state = revealed[key]}
	<section class="kv-card">
		<header>
			<h3>{key} <span class="muted small">({len}b)</span></h3>
			<div class="acts">
				<button class="ghost" onclick={() => toggle(key)} disabled={pending[key]}>
					{#if pending[key]}…{:else if state}hide{:else}reveal{/if}
				</button>
				{#if isShown(state) && !state.masked}
					<button class="ghost" onclick={() => copy(key)} title="Copy decoded value">copy</button>
				{/if}
			</div>
		</header>
		{#if isShown(state)}
			<pre class:masked={state.masked}>{state.value}</pre>
			{#if state.masked}
				<p class="muted small mask-note">SRE role — plaintext is admin-only. Mask matches real length.</p>
			{/if}
		{:else if isError(state)}
			<pre class="err">{state.error}</pre>
		{:else}
			<pre class="masked">{'•'.repeat(Math.min(len || 8, 32))}</pre>
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
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--accent); }
	.ghost:disabled { cursor: wait; opacity: 0.6; }
	pre { margin: 0; padding: 0.6rem 0.8rem; background: #0a0c10; color: #e2e8f0; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; overflow: auto; max-height: 400px; white-space: pre-wrap; word-break: break-all; }
	pre.masked { color: var(--muted); }
	pre.err { color: #fb7185; }
	.mask-note { margin: 0.4rem 0 0; }
</style>
