<script lang="ts">
	import { toast } from './toast.svelte';
	const items = $derived(toast.items);
</script>

<div class="toast-stack" aria-live="polite" aria-atomic="false">
	{#each items as t (t.id)}
		<div class="toast toast-{t.kind}" role="status">
			<span class="msg">{t.msg}</span>
			<button class="x" onclick={() => toast.dismiss(t.id)} aria-label="Dismiss" title="Dismiss">×</button>
		</div>
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
		display: inline-flex;
		gap: 0.5rem;
		align-items: flex-start;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.55rem 0.75rem 0.55rem 0.95rem;
		border-radius: 6px;
		border: 1px solid var(--rule);
		background: var(--bg-elev);
		color: var(--fg);
		max-width: 480px;
		text-align: left;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
	}
	.msg {
		/* Selectable so the operator can copy error messages — the
		   whole point of stickier err toasts. */
		user-select: text;
		white-space: pre-wrap;
		word-break: break-word;
		flex: 1 1 auto;
	}
	.x {
		font: inherit;
		font-size: 1rem;
		line-height: 1;
		padding: 0 0.35rem;
		background: transparent;
		border: 0;
		color: var(--muted);
		cursor: pointer;
		flex: 0 0 auto;
	}
	.x:hover { color: var(--fg); }
	.toast-ok { color: #6ee7b7; border-color: #6ee7b7; }
	.toast-warn { color: #fcd34d; border-color: #fcd34d; }
	.toast-err { color: #fb7185; border-color: #fb7185; }
</style>
