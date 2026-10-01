<script lang="ts">
	import { onDestroy } from 'svelte';
	// Type-only: xterm touches `self` at module load, so a static import
	// breaks SSR of this page. The runtime modules load in ensureTerm().
	import type { Terminal } from 'xterm';
	import type { FitAddon } from 'xterm-addon-fit';
	import 'xterm/css/xterm.css';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let cluster = $state(data.defaultCluster);
	let connected = $state(false);
	let connecting = $state(false);
	let lastError = $state<string | null>(null);
	let podName = $state<string | null>(null);

	let termHost: HTMLDivElement | null = $state(null);
	// svelte-ignore non_reactive_update
	let term: Terminal | null = null;
	// svelte-ignore non_reactive_update
	let fit: FitAddon | null = null;
	// svelte-ignore non_reactive_update
	let ws: WebSocket | null = null;

	const STDIN = 0;
	const STDOUT = 1;
	const STDERR = 2;
	const ERR = 3;
	const RESIZE = 4;
	// Out-of-band channel start.js uses to ship status messages
	// (e.g. the ephemeral pod's name once it's running) so the UI
	// can show the operator what was created.
	const META = 5;

	// svelte-ignore non_reactive_update
	let termReady: Promise<void> | null = null;

	function ensureTerm(): Promise<void> {
		if (!termHost) return Promise.resolve();
		termReady ??= loadTerm(termHost);
		return termReady;
	}

	async function loadTerm(host: HTMLDivElement) {
		const [{ Terminal }, { FitAddon }] = await Promise.all([
			import('xterm'),
			import('xterm-addon-fit')
		]);
		term = new Terminal({
			cursorBlink: true,
			fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
			fontSize: 13,
			theme: { background: '#0a0c10', foreground: '#e2e8f0' }
		});
		fit = new FitAddon();
		term.loadAddon(fit);
		term.open(host);
		fit.fit();
		term.onData((d) => {
			if (!ws || ws.readyState !== WebSocket.OPEN) return;
			const body = new TextEncoder().encode(d);
			const frame = new Uint8Array(body.length + 1);
			frame[0] = STDIN;
			frame.set(body, 1);
			ws.send(frame);
		});
		term.onResize(({ cols, rows }) => {
			if (!ws || ws.readyState !== WebSocket.OPEN) return;
			const json = JSON.stringify({ Width: cols, Height: rows });
			const body = new TextEncoder().encode(json);
			const frame = new Uint8Array(body.length + 1);
			frame[0] = RESIZE;
			frame.set(body, 1);
			ws.send(frame);
		});
	}

	async function connect() {
		if (connecting || connected) return;
		connecting = true;
		await ensureTerm();
		if (!term) {
			connecting = false;
			return;
		}
		lastError = null;
		podName = null;
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const u = new URL(`${proto}//${location.host}/ws/cloudshell/${cluster}`);
		const sock = new WebSocket(u.toString());
		sock.binaryType = 'arraybuffer';
		ws = sock;
		term.write('\x1b[2J\x1b[H\x1b[36m[platform-dash] spinning up cloudshell pod…\x1b[0m\r\n');
		sock.onopen = () => {
			connecting = false;
			connected = true;
			term?.focus();
			if (term) {
				const json = JSON.stringify({ Width: term.cols, Height: term.rows });
				const body = new TextEncoder().encode(json);
				const frame = new Uint8Array(body.length + 1);
				frame[0] = RESIZE;
				frame.set(body, 1);
				sock.send(frame);
			}
		};
		sock.onmessage = (ev) => {
			const buf = new Uint8Array(ev.data as ArrayBuffer);
			if (buf.length === 0) return;
			const channel = buf[0];
			const body = buf.subarray(1);
			if (channel === STDOUT || channel === STDERR) {
				term?.write(body);
			} else if (channel === ERR) {
				const msg = new TextDecoder().decode(body);
				lastError = msg;
				term?.write(`\r\n\x1b[31m[error] ${msg}\x1b[0m\r\n`);
			} else if (channel === META) {
				try {
					const meta = JSON.parse(new TextDecoder().decode(body));
					if (typeof meta.pod === 'string') podName = meta.pod;
				} catch {
					/* */
				}
			}
		};
		sock.onerror = () => {
			lastError = 'WebSocket error';
		};
		sock.onclose = () => {
			connecting = false;
			connected = false;
			ws = null;
		};
	}
	function disconnect() {
		if (ws) {
			try {
				ws.close();
			} catch {
				/* */
			}
			ws = null;
		}
		connected = false;
		connecting = false;
	}

	function onWindowResize() {
		try {
			fit?.fit();
		} catch {
			/* */
		}
	}

	$effect(() => {
		window.addEventListener('resize', onWindowResize);
		return () => window.removeEventListener('resize', onWindowResize);
	});
	$effect(() => {
		ensureTerm();
		queueMicrotask(() => {
			try {
				fit?.fit();
			} catch {
				/* */
			}
		});
	});

	onDestroy(() => {
		disconnect();
		try {
			term?.dispose();
		} catch {
			/* */
		}
	});

	async function copyTerm() {
		if (!term) return;
		const sel = term.getSelection();
		if (!sel) {
			toast.show('nothing selected', 'warn');
			return;
		}
		try {
			await navigator.clipboard.writeText(sel);
			toast.show('copied');
		} catch (err) {
			toast.show(`copy failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
		}
	}
</script>

<div class="header">
	<h1>Cloud shell</h1>
	<div class="actions">
		{#if data.clusters.length > 1}
			<label class="field">
				<span>cluster</span>
				<select bind:value={cluster} disabled={connected || connecting}>
					{#each data.clusters as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if connected}
			<button class="ghost danger" onclick={disconnect}>disconnect</button>
		{:else}
			<button class="connect" onclick={connect} disabled={connecting}>
				{connecting ? 'connecting…' : 'connect'}
			</button>
		{/if}
		<button class="ghost" onclick={copyTerm} disabled={!term}>copy selection</button>
	</div>
</div>

<p class="muted small">
	Spins up an ephemeral pod (image: <code>bitnami/kubectl</code>) in the
	<code>platform</code> namespace under the dash service account, exec's into it,
	and deletes it when the WS closes. Sessions are audited as <code>cloudshell-open/close</code>;
	keystrokes are not logged.
	{#if podName}<br /><span class="ok">pod: <code>{podName}</code></span>{/if}
	{#if lastError}<br /><span class="err">{lastError}</span>{/if}
</p>

<div class="term-host" bind:this={termHost}></div>

<style>
	.header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
	.header h1 { margin: 0; }
	.actions { display: inline-flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
	.field { display: inline-flex; gap: 0.4rem; align-items: center; font-size: 0.8rem; color: var(--fg-soft); }
	.field select {
		font: inherit; font-size: 0.85rem; padding: 0.35rem 0.6rem;
		background: var(--bg); border: 1px solid var(--rule);
		color: var(--fg); border-radius: 6px;
	}
	.field select:focus { outline: none; border-color: var(--accent); }
	.connect {
		font: inherit; font-size: 0.85rem; padding: 0.45rem 0.95rem;
		background: var(--accent); color: var(--invert-fg); border: 0;
		border-radius: 6px; cursor: pointer; font-weight: 500;
	}
	.connect:hover:not(:disabled) { background: var(--accent-d); }
	.connect:disabled { opacity: 0.5; cursor: wait; }
	.ghost {
		font: inherit; font-size: 0.85rem; padding: 0.4rem 0.85rem;
		border: 1px solid var(--rule); background: transparent; color: var(--fg-soft);
		border-radius: 6px; cursor: pointer;
	}
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.ghost:disabled { opacity: 0.5; cursor: not-allowed; }
	.ghost.danger:hover { color: #fb7185; border-color: #fb7185; }

	.small { font-size: 0.85rem; margin: 0.5rem 0 1rem; }
	.err { color: #fb7185; }
	.ok { color: var(--accent); }
	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }

	.term-host {
		min-height: calc(100vh - 220px);
		background: #0a0c10;
		border: 1px solid var(--rule);
		border-radius: 6px;
		padding: 0.5rem;
	}
</style>
