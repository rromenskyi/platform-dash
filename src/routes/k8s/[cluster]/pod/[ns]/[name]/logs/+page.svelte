<script lang="ts">
	import { onDestroy } from 'svelte';
	import LiveDot from '$lib/LiveDot.svelte';
	import type { LiveStreamState } from '$lib/live-list.svelte';

	let { data } = $props();

	// Re-sync container on navigation (different pod, different ?container=)
	// without trapping the user in their first selection.
	let container = $state('');
	$effect(() => {
		container = data.initialContainer;
	});
	let tailLines = $state(200);
	let follow = $state(true);
	let previous = $state(false);
	let timestamps = $state(false);
	let grep = $state('');

	let lines = $state<string[]>([]);
	let connected = $state(false);
	let streamState = $state<LiveStreamState>('idle');
	let errMsg = $state<string | null>(null);
	let autoscroll = $state(true);

	let logBox: HTMLDivElement | null = null;
	let es: EventSource | null = null;
	let scheduledScroll = false;

	const filtered = $derived(
		grep ? lines.filter((l) => l.toLowerCase().includes(grep.toLowerCase())) : lines
	);

	function buildUrl(): string {
		const u = new URL(
			`/k8s/${data.cluster}/pod/${data.ns}/${data.name}/logs`,
			window.location.origin
		);
		if (container) u.searchParams.set('container', container);
		u.searchParams.set('tailLines', String(tailLines));
		u.searchParams.set('follow', follow ? '1' : '0');
		if (previous) u.searchParams.set('previous', '1');
		if (timestamps) u.searchParams.set('timestamps', '1');
		return u.toString();
	}

	function open() {
		close();
		errMsg = null;
		lines = [];
		connected = false;
		streamState = 'connecting';
		const src = new EventSource(buildUrl());
		es = src;
		src.onopen = () => {
			if (es !== src) return;
			connected = true;
			streamState = 'open';
		};
		src.onmessage = (ev) => {
			if (es === src) {
				connected = true;
				streamState = 'open';
			}
			lines.push(ev.data);
			// Cap the buffer to keep the DOM happy on very chatty pods —
			// the streaming endpoint can deliver thousands of lines/sec
			// during a CrashLoopBackOff replay.
			if (lines.length > 5000) lines = lines.slice(-5000);
			scheduleScroll();
		};
		src.addEventListener('error', (ev) => {
			if (es !== src) return;
			const msg = (ev as MessageEvent).data;
			if (msg) errMsg = String(msg);
			connected = false;
			streamState = src.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting';
		});
		src.addEventListener('end', () => {
			if (es !== src) return;
			connected = false;
			streamState = 'closed';
			src.close();
			es = null;
		});
	}

	function close() {
		if (es) {
			es.close();
			es = null;
		}
		connected = false;
		streamState = 'idle';
	}

	function scheduleScroll() {
		if (!autoscroll || scheduledScroll) return;
		scheduledScroll = true;
		requestAnimationFrame(() => {
			scheduledScroll = false;
			if (logBox && autoscroll) {
				logBox.scrollTop = logBox.scrollHeight;
			}
		});
	}

	function onScroll() {
		if (!logBox) return;
		// Disable autoscroll if user scrolls up away from the bottom; re-
		// enable when they scroll back to within ~40px of the bottom so
		// "follow" feels natural without trapping the viewport.
		const distance = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight;
		autoscroll = distance < 40;
	}

	function clearLines() {
		lines = [];
	}

	function downloadAll() {
		const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `${data.ns}-${data.name}-${container || 'all'}.log`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	$effect(() => {
		// Auto-open when key params change: container, follow, previous,
		// timestamps, tailLines. grep is client-only — no reconnect.
		void container;
		void follow;
		void previous;
		void timestamps;
		void tailLines;
		open();
	});

	onDestroy(close);
</script>

<p class="crumb">
	<a href="/k8s/{data.cluster}/pod/{data.ns}/{data.name}">← {data.ns}/{data.name}</a>
</p>

<div class="header">
	<h1>Logs</h1>
	<div class="status">
		<LiveDot state={streamState} />
		{#if streamState === 'open'}live
		{:else if streamState === 'connecting'}connecting…
		{:else if streamState === 'reconnecting'}reconnecting…
		{:else if streamState === 'closed'}{follow ? 'closed' : 'stopped'}
		{:else}idle{/if}
		<span class="muted small">· {filtered.length}{grep ? ` of ${lines.length}` : ''} lines</span>
	</div>
</div>

<div class="controls">
	<label class="field">
		<span>container</span>
		<select bind:value={container}>
			{#each data.containers as c}
				<option value={c}>{c}</option>
			{/each}
			{#if data.initContainers.length > 0}
				<optgroup label="init containers">
					{#each data.initContainers as c}
						<option value={c}>{c}</option>
					{/each}
				</optgroup>
			{/if}
		</select>
	</label>

	<label class="field">
		<span>tail</span>
		<input type="number" min="1" max="10000" step="50" bind:value={tailLines} />
	</label>

	<label class="field check">
		<input type="checkbox" bind:checked={follow} />
		<span>follow</span>
	</label>

	<label class="field check" title="Show logs from the previously terminated instance of this container">
		<input type="checkbox" bind:checked={previous} />
		<span>previous</span>
	</label>

	<label class="field check">
		<input type="checkbox" bind:checked={timestamps} />
		<span>timestamps</span>
	</label>

	<label class="field grow">
		<span>grep</span>
		<input type="search" bind:value={grep} placeholder="client-side filter…" />
	</label>

	<div class="actions">
		<button class="ghost" onclick={clearLines} disabled={lines.length === 0} title="Clear buffer">clear</button>
		<button class="ghost" onclick={downloadAll} disabled={lines.length === 0} title="Download as .log">save</button>
	</div>
</div>

{#if errMsg}
	<p class="error">{errMsg}</p>
{/if}

<div class="logbox" bind:this={logBox} onscroll={onScroll}>
	{#each filtered as line, i (i)}
		<div class="line">{line || ' '}</div>
	{/each}
	{#if lines.length === 0 && connected}
		<div class="line muted">[waiting for output…]</div>
	{/if}
</div>

<style>
	.crumb { font-size: 0.85rem; margin: 0 0 1rem; }
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }

	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.header h1 { margin: 0; }

	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--fg-soft);
	}
	.small { font-size: 0.85rem; }

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin: 0.85rem 0 0.6rem;
		padding: 0.55rem 0.75rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
	}
	.field {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--muted);
	}
	.field span {
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 0.7rem;
	}
	.field.check span { text-transform: none; letter-spacing: 0; color: var(--fg-soft); }
	.field.grow { flex: 1 1 200px; min-width: 0; }
	.field input[type='number'] {
		width: 80px;
	}
	.field select,
	.field input[type='number'],
	.field input[type='search'] {
		padding: 0.3rem 0.55rem;
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 6px;
		color: var(--fg);
		font: inherit;
		font-size: 0.85rem;
	}
	.field input[type='search'] { width: 100%; }
	.field select:focus,
	.field input:focus { outline: none; border-color: var(--accent); }
	.field input[type='checkbox'] { accent-color: var(--accent); }

	.actions {
		display: inline-flex;
		gap: 0.4rem;
		margin-left: auto;
	}
	.ghost {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
	}
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.ghost:disabled { opacity: 0.5; cursor: not-allowed; }

	.logbox {
		background: #0a0c10;
		color: #e2e8f0;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.45;
		border: 1px solid var(--rule);
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
		max-height: calc(100vh - 280px);
		min-height: 320px;
		overflow: auto;
	}
	.line {
		white-space: pre-wrap;
		word-break: break-all;
	}
	.line.muted { color: var(--muted); font-style: italic; }

	.error {
		padding: 0.65rem 0.9rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
		font-size: 0.85rem;
	}
</style>
