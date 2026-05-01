<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { savedViews } from './saved-views.svelte';
	import { toast } from './toast.svelte';

	let open = $state(false);
	let views = $derived(savedViews.items);

	function toggle() {
		open = !open;
	}
	function close() {
		open = false;
	}

	// Default name: humanise the current path. /k8s/local/workloads → "k8s/local · workloads"
	function defaultName(): string {
		const segs = page.url.pathname.split('/').filter(Boolean);
		const ns = page.url.searchParams.get('ns');
		const base = segs.join(' / ') || '/';
		return ns ? `${base}  (ns: ${ns})` : base;
	}

	function saveCurrent() {
		const name = prompt('Name this view:', defaultName());
		if (!name) return;
		savedViews.add(name, page.url.pathname, page.url.search);
		toast.show(`Saved view "${name}"`);
	}

	async function go(href: string) {
		close();
		await goto(href);
	}

	function onDelete(id: string, ev: MouseEvent) {
		ev.stopPropagation();
		savedViews.remove(id);
	}
</script>

<svelte:window onclick={close} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="wrap" onclick={(e) => e.stopPropagation()}>
	<button class="btn" onclick={toggle} title="Saved views">
		Saved {views.length > 0 ? `(${views.length})` : ''}
	</button>
	{#if open}
		<div class="menu" role="menu">
			<button class="row save-current" onclick={saveCurrent}>+ Save current view</button>
			<div class="divider"></div>
			{#if views.length === 0}
				<p class="empty">Nothing saved yet.</p>
			{:else}
				{#each views as v (v.id)}
					<div class="row item">
						<button class="goto" onclick={() => go(savedViews.href(v))}>
							<span class="name">{v.name}</span>
							<span class="path">{v.path}{v.search}</span>
						</button>
						<button class="del" onclick={(e) => onDelete(v.id, e)} title="Delete">×</button>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		display: inline-block;
	}
	.btn {
		font: inherit;
		font-size: 0.88rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
	}
	.btn:hover { color: var(--fg); border-color: var(--muted); }

	.menu {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		min-width: 280px;
		max-width: 360px;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
		padding: 0.3rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 50;
		max-height: 70vh;
		overflow: auto;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
	}
	.save-current {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.6rem;
		background: transparent;
		border: 0;
		color: var(--accent);
		cursor: pointer;
		text-align: left;
		border-radius: 4px;
		width: 100%;
	}
	.save-current:hover { background: var(--bg); }

	.divider {
		height: 1px;
		background: var(--rule);
		margin: 0.3rem 0;
	}

	.empty {
		font-size: 0.82rem;
		color: var(--muted);
		padding: 0.4rem 0.6rem;
		margin: 0;
	}

	.item { padding: 0; }
	.goto {
		flex: 1;
		font: inherit;
		font-size: 0.83rem;
		padding: 0.35rem 0.55rem;
		background: transparent;
		border: 0;
		color: var(--fg);
		cursor: pointer;
		text-align: left;
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.05rem;
		min-width: 0;
	}
	.goto:hover { background: var(--bg); }
	.name { color: var(--fg); }
	.path {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.del {
		font: inherit;
		font-size: 1rem;
		line-height: 1;
		padding: 0.15rem 0.45rem;
		background: transparent;
		border: 0;
		color: var(--muted);
		cursor: pointer;
		border-radius: 4px;
	}
	.del:hover { color: #fb7185; background: var(--bg); }
</style>
