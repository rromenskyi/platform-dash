<script lang="ts">
	import { toast } from './toast.svelte';
	const items = $derived(toast.items);
</script>

<div class="toast-stack" aria-live="polite" aria-atomic="false">
	{#each items as t (t.id)}
		<button class="toast toast-{t.kind}" onclick={() => toast.dismiss(t.id)} title="Dismiss">
			{t.msg}
		</button>
	{/each}
</div>

<style>
	.toast-stack {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 100;
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.55rem 0.95rem;
		border-radius: 6px;
		border: 1px solid var(--rule);
		background: var(--bg-elev);
		color: var(--fg);
		cursor: pointer;
		max-width: 360px;
		text-align: left;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
	}
	.toast-ok { color: #6ee7b7; border-color: #6ee7b7; }
	.toast-warn { color: #fcd34d; border-color: #fcd34d; }
	.toast-err { color: #fb7185; border-color: #fb7185; }
</style>
