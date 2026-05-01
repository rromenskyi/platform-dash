<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { data, children } = $props();

	// Local input state — kept in sync with data.{ns,cluster} whenever
	// the URL changes externally (back/forward nav, explicit goto),
	// but free to drift while the user is mid-type before commit.
	let nsInput = $state('');
	let clusterSelect = $state('');
	$effect(() => {
		nsInput = data.ns;
	});
	$effect(() => {
		clusterSelect = data.cluster;
	});

	// Push the selected namespace into the URL so every nav link, page
	// reload and load function reads it from the same source. replaceState
	// keeps the back button useful (one history entry per real navigation,
	// not one per filter keystroke).
	async function applyNs(value: string) {
		const url = new URL(page.url);
		if (value) url.searchParams.set('ns', value);
		else url.searchParams.delete('ns');
		await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function onCommit() {
		if (nsInput !== data.ns) applyNs(nsInput);
	}
	function onClear() {
		nsInput = '';
		applyNs('');
	}
	function onNsKey(e: KeyboardEvent) {
		// Native datalist commits on blur; explicit Enter so users
		// don't have to tab away for the filter to apply.
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
			onCommit();
		}
	}

	// Cluster switch — preserves the current sub-path so jumping to a
	// different cluster lands on the same kind of view (Workloads stays
	// Workloads, etc.). Drops the per-resource [name] segments because
	// they're cluster-specific (a pod name on cluster A almost never
	// exists on cluster B).
	function onClusterChange() {
		const next = clusterSelect;
		if (!next || next === data.cluster) return;
		const segs = page.url.pathname.split('/').filter(Boolean); // ['k8s', cluster, ...]
		// Keep top-level section under [cluster] only — strip deeper segments
		// so we don't dead-end on /k8s/B/pod/foo/bar that doesn't exist on B.
		const section = segs[2] ?? '';
		const target = section ? `/k8s/${next}/${section}` : `/k8s/${next}`;
		const search = page.url.search;
		goto(`${target}${search}`);
	}
</script>

<div class="ctx-bar">
	<div class="field">
		<label for="cluster-select">cluster</label>
		<select id="cluster-select" class="cluster-select" bind:value={clusterSelect} onchange={onClusterChange}>
			{#each data.clusters as c}
				<option value={c}>{c}</option>
			{/each}
		</select>
	</div>

	<div class="field">
		<label for="global-ns">namespace</label>
		<input
			id="global-ns"
			class="ns-input"
			type="search"
			list="global-ns-options"
			bind:value={nsInput}
			onchange={onCommit}
			onblur={onCommit}
			onkeydown={onNsKey}
			placeholder="all namespaces"
		/>
		<datalist id="global-ns-options">
			{#each data.namespaces as n}
				<option value={n}></option>
			{/each}
		</datalist>
		{#if data.ns}
			<button class="clear" onclick={onClear} title="Show all namespaces">×</button>
			<span class="active-ns">filtering by <code>{data.ns}</code></span>
		{/if}
	</div>
</div>

{@render children()}

<style>
	.ctx-bar {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
		padding: 0.6rem 0.85rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
	}
	.field {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.field label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.cluster-select {
		padding: 0.35rem 0.7rem;
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 6px;
		color: var(--fg);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.cluster-select:focus { outline: none; border-color: var(--accent); }
	.ns-input {
		flex: 0 1 260px;
		min-width: 160px;
		padding: 0.4rem 0.7rem;
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 6px;
		color: var(--fg);
		font: inherit;
		font-size: 0.88rem;
	}
	.ns-input:focus { outline: none; border-color: var(--accent); }
	.clear {
		font: inherit;
		font-size: 1rem;
		line-height: 1;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
	}
	.clear:hover { color: var(--fg); border-color: var(--muted); }
	.active-ns {
		font-size: 0.82rem;
		color: var(--muted);
	}
	.active-ns code {
		font-family: var(--font-mono);
		color: var(--accent);
	}
</style>
