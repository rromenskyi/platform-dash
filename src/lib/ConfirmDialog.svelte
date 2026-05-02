<script lang="ts">
	import { confirmBus } from './confirm.svelte';

	const p = $derived(confirmBus.pending);

	function ok() {
		confirmBus.resolve(true);
	}
	function cancel() {
		confirmBus.resolve(false);
	}

	$effect(() => {
		if (!p) return;
		// Focus the confirm button when the dialog opens so Enter
		// submits and Esc cancels without the operator reaching for
		// the mouse.
		const t = setTimeout(() => {
			document.querySelector<HTMLButtonElement>('.cd-confirm')?.focus();
		}, 0);
		return () => clearTimeout(t);
	});

	function onKey(e: KeyboardEvent) {
		if (!p) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			ok();
		}
	}
	$effect(() => {
		if (!p) return;
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#if p}
	<div
		class="backdrop"
		role="button"
		tabindex="0"
		onclick={cancel}
		onkeydown={(e) => e.key === 'Escape' && cancel()}
	></div>
	<div class="dialog" role="dialog" aria-modal="true" aria-label={p.title}>
		<header><h2>{p.title}</h2></header>
		{#if p.body}
			<p class="body">{p.body}</p>
		{/if}
		<footer>
			<button class="ghost" onclick={cancel}>{p.cancel ?? 'Cancel'}</button>
			<button
				class="cd-confirm"
				class:danger={p.danger}
				onclick={ok}
			>{p.confirm ?? 'OK'}</button>
		</footer>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
		z-index: 100; cursor: default;
	}
	.dialog {
		position: fixed;
		top: 30%; left: 50%; transform: translate(-50%, -50%);
		width: min(440px, 92vw);
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 10px;
		padding: 1rem 1.1rem;
		z-index: 101;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
	}
	.dialog h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
	.body { margin: 0 0 1rem; white-space: pre-line; color: var(--fg-soft); font-size: 0.92rem; }
	footer { display: flex; justify-content: flex-end; gap: 0.5rem; }
	footer button {
		font: inherit; font-size: 0.86rem; padding: 0.45rem 0.95rem;
		background: var(--accent); color: var(--invert-fg); border: 0;
		border-radius: 6px; cursor: pointer; font-weight: 500;
	}
	footer button:hover { background: var(--accent-d); }
	footer .ghost {
		background: transparent; color: var(--fg-soft); border: 1px solid var(--rule);
	}
	footer .ghost:hover { color: var(--fg); border-color: var(--muted); background: transparent; }
	footer .danger {
		background: #fb7185; color: #1c1917;
	}
	footer .danger:hover { background: #f43f5e; }
</style>
