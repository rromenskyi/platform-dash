<script lang="ts">
	import { copyKubectl, type KubectlTarget, type KubectlVerb } from './kubectl';

	let { target, verbs = ['get', 'describe', 'edit', 'delete'] }: {
		target: KubectlTarget;
		verbs?: KubectlVerb[];
	} = $props();

	let open = $state(false);

	function toggle(e: MouseEvent) {
		e.stopPropagation();
		open = !open;
	}
	function close() {
		open = false;
	}
	async function pick(v: KubectlVerb, e: MouseEvent) {
		e.stopPropagation();
		close();
		await copyKubectl(v, target);
	}
</script>

<svelte:window onclick={close} />

<span class="wrap">
	<button class="trigger" onclick={toggle} title="Copy kubectl command">k</button>
	{#if open}
		<div class="menu">
			{#each verbs as v}
				<button class="item" onclick={(e) => pick(v, e)}>
					{v}
				</button>
			{/each}
		</div>
	{/if}
</span>

<style>
	.wrap {
		position: relative;
		display: inline-block;
	}
	.trigger {
		font: inherit;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 3px;
		cursor: pointer;
		min-width: 1.4rem;
	}
	.trigger:hover { color: var(--accent); border-color: var(--accent); }
	.menu {
		position: absolute;
		top: calc(100% + 0.2rem);
		right: 0;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 6px;
		padding: 0.2rem;
		min-width: 110px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
		z-index: 40;
	}
	.item {
		font: inherit;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		padding: 0.25rem 0.55rem;
		background: transparent;
		border: 0;
		color: var(--fg-soft);
		cursor: pointer;
		width: 100%;
		text-align: left;
		border-radius: 3px;
	}
	.item:hover { background: var(--bg); color: var(--fg); }
</style>
