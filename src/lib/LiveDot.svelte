<script lang="ts">
	import type { LiveStreamState } from './live-list.svelte';

	let { state }: { state: LiveStreamState } = $props();

	// Same visual vocabulary as the existing `.dot` indicator on each
	// page (green when on, dim when off) — extended with yellow for
	// reconnecting + red for closed-after-error.
	const cls = $derived(
		state === 'open'
			? 'on'
			: state === 'connecting'
				? 'connecting'
				: state === 'reconnecting'
					? 'reconnecting'
					: state === 'closed'
						? 'closed'
						: 'off'
	);
	const title = $derived(
		state === 'open'
			? 'Live · stream open'
			: state === 'connecting'
				? 'Live · connecting'
				: state === 'reconnecting'
					? 'Live · reconnecting'
					: state === 'closed'
						? 'Live · stream closed (re-toggle)'
						: 'Live · idle'
	);
</script>

<span class="dot {cls}" {title}></span>

<style>
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
		background: var(--muted);
		flex: none;
	}
	.dot.on { background: #6ee7b7; box-shadow: 0 0 6px #6ee7b7; }
	.dot.connecting {
		background: #fcd34d;
		box-shadow: 0 0 6px #fcd34d;
		animation: pulse 1s ease-in-out infinite;
	}
	.dot.reconnecting {
		background: #fcd34d;
		box-shadow: 0 0 6px #fcd34d;
		animation: pulse 0.6s ease-in-out infinite;
	}
	.dot.closed { background: #fb7185; box-shadow: 0 0 6px #fb7185; }
	.dot.off { background: var(--muted); }
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}
</style>
