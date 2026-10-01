<script lang="ts">
	import { toast } from '$lib/toast.svelte';
	import { redactHeaders } from '$lib/http-headers';

	let { data } = $props();

	type Header = { key: string; value: string; on: boolean };
	type Saved = {
		url: string;
		method: string;
		headers: Header[];
		body: string;
	};

	const STORE_KEY = 'platform-dash:http-test:v1';

	function loadSaved(): Saved {
		const def: Saved = {
			url: '',
			method: 'GET',
			headers: [{ key: '', value: '', on: true }],
			body: ''
		};
		if (typeof localStorage === 'undefined') return def;
		try {
			const raw = localStorage.getItem(STORE_KEY);
			if (!raw) return def;
			const p = JSON.parse(raw) as Partial<Saved>;
			return {
				url: p.url ?? '',
				method: p.method ?? 'GET',
				headers: p.headers && p.headers.length > 0 ? p.headers : def.headers,
				body: p.body ?? ''
			};
		} catch {
			return def;
		}
	}

	const saved = loadSaved();
	let url = $state(saved.url);
	let method = $state<'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>(
		(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).includes(saved.method as never)
			? (saved.method as 'GET')
			: 'GET'
	);
	let headers = $state<Header[]>(saved.headers);
	let body = $state(saved.body);
	let sending = $state(false);

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(
				STORE_KEY,
				JSON.stringify({ url, method, headers: redactHeaders(headers), body } satisfies Saved)
			);
		} catch {
			/* quota — silent */
		}
	});

	// Last-N request history. Stored separately so the inline editor's
	// localStorage round-trip stays small. Each entry includes enough
	// to re-fire the same call: url, method, headers (with on flags),
	// body, plus result status + ms for the recall row.
	type HistoryEntry = {
		at: string;
		url: string;
		method: string;
		headers: Header[];
		body: string;
		status?: number;
		ok: boolean;
		ms: number;
	};
	const HISTORY_KEY = 'platform-dash:http-test:history:v1';
	const HISTORY_CAP = 25;
	let history = $state<HistoryEntry[]>(loadHistory());

	function loadHistory(): HistoryEntry[] {
		if (typeof localStorage === 'undefined') return [];
		try {
			const raw = localStorage.getItem(HISTORY_KEY);
			if (!raw) return [];
			const arr = JSON.parse(raw);
			return Array.isArray(arr) ? (arr as HistoryEntry[]).slice(0, HISTORY_CAP) : [];
		} catch {
			return [];
		}
	}
	function persistHistory() {
		if (typeof localStorage === 'undefined') return;
		try {
			const stored = history
				.slice(0, HISTORY_CAP)
				.map((h) => ({ ...h, headers: redactHeaders(h.headers) }));
			localStorage.setItem(HISTORY_KEY, JSON.stringify(stored));
		} catch {
			/* quota — silent */
		}
	}
	function pushHistory(entry: HistoryEntry) {
		history = [entry, ...history].slice(0, HISTORY_CAP);
		persistHistory();
	}
	function recall(h: HistoryEntry) {
		url = h.url;
		method = h.method as typeof method;
		headers = h.headers.length > 0 ? h.headers : [{ key: '', value: '', on: true }];
		body = h.body;
		result = null;
	}
	function clearHistory() {
		history = [];
		persistHistory();
	}

	function addHeader() {
		headers = [...headers, { key: '', value: '', on: true }];
	}
	function removeHeader(i: number) {
		headers = headers.filter((_, idx) => idx !== i);
		if (headers.length === 0) addHeader();
	}

	type Result =
		| {
				ok: true;
				status: number;
				statusText: string;
				ms: number;
				headers: Record<string, string>;
				snippet: string | null;
				truncated: boolean;
		  }
		| { ok: false; error: string; ms: number };

	let result = $state<Result | null>(null);

	async function send() {
		if (sending) return;
		if (!url.trim()) {
			toast.show('url required', 'err');
			return;
		}
		sending = true;
		result = null;
		const headersMap: Record<string, string> = {};
		for (const h of headers) {
			if (!h.on) continue;
			const k = h.key.trim();
			if (!k) continue;
			headersMap[k] = h.value;
		}
		try {
			const res = await fetch(`/api/http-test`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					url,
					method,
					headers: headersMap,
					body: method === 'GET' || method === 'HEAD' ? undefined : body
				})
			});
			if (!res.ok) {
				const text = await res.text();
				result = { ok: false, error: text || res.statusText, ms: 0 };
				toast.show(`request failed: ${text || res.statusText}`, 'err');
				pushHistory({
					at: new Date().toISOString(),
					url,
					method,
					headers,
					body,
					ok: false,
					ms: 0
				});
				return;
			}
			result = (await res.json()) as Result;
			pushHistory({
				at: new Date().toISOString(),
				url,
				method,
				headers,
				body,
				status: 'status' in result ? result.status : undefined,
				ok: 'status' in result ? result.status < 400 : false,
				ms: result.ms
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			result = { ok: false, error: msg, ms: 0 };
			toast.show(`request failed: ${msg}`, 'err');
			pushHistory({
				at: new Date().toISOString(),
				url,
				method,
				headers,
				body,
				ok: false,
				ms: 0
			});
		} finally {
			sending = false;
		}
	}

	let copyFlash = $state(false);
	let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;
	async function copySnippet() {
		if (!result || !('snippet' in result) || !result.snippet) return;
		try {
			await navigator.clipboard.writeText(result.snippet);
			// Brief visual flash on the button so the operator sees
			// "yes, that copied" without scanning the toast stack.
			copyFlash = true;
			if (copyFlashTimer) clearTimeout(copyFlashTimer);
			copyFlashTimer = setTimeout(() => (copyFlash = false), 500);
		} catch (err) {
			toast.show(`copy failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
		}
	}

	function clearAll() {
		url = '';
		headers = [{ key: '', value: '', on: true }];
		body = '';
		result = null;
	}

	const statusClass = $derived.by(() => {
		if (!result || !('status' in result)) return '';
		if (result.status >= 500) return 'sx-bad';
		if (result.status >= 400) return 'sx-warn';
		if (result.status >= 300) return 'sx-info';
		if (result.status >= 200) return 'sx-ok';
		return '';
	});

	// Try to JSON-pretty the body when content-type says so. Falls
	// back to raw on parse error.
	const prettyBody = $derived.by(() => {
		if (!result || !('snippet' in result) || !result.snippet) return null;
		const ct = result.headers?.['content-type'] ?? '';
		if (ct.includes('json')) {
			try {
				return JSON.stringify(JSON.parse(result.snippet), null, 2);
			} catch {
				/* fall through */
			}
		}
		return result.snippet;
	});
</script>

<div class="header">
	<div>
		<h1>HTTP tester</h1>
		<p class="muted small">
			Server-side fetch from inside the dash pod. Use to verify ingress routes, hit cluster-internal services, or sanity-check API tokens. Headers + body never leave audit logs unmasked, but the URL + method + status do.
		</p>
	</div>
</div>

<section class="req">
	<div class="line">
		<select bind:value={method}>
			<option>GET</option>
			<option>HEAD</option>
			<option>POST</option>
			<option>PUT</option>
			<option>PATCH</option>
			<option>DELETE</option>
		</select>
		<input
			type="text"
			class="url"
			bind:value={url}
			placeholder="https://app.example.com/health"
			onkeydown={(e) => e.key === 'Enter' && send()}
		/>
		<button class="send" onclick={send} disabled={sending}>{sending ? 'sending…' : 'send'}</button>
		<button class="ghost" onclick={clearAll} disabled={sending}>clear</button>
	</div>

	<h3>Headers</h3>
	<div class="hdrs">
		{#each headers as h, i}
			<div class="hrow">
				<input type="checkbox" bind:checked={h.on} title="Disable / enable" />
				<input type="text" class="hk" bind:value={h.key} placeholder="Header-Name" />
				<input type="text" class="hv" bind:value={h.value} placeholder="value (eg. Bearer …)" />
				<button class="x" onclick={() => removeHeader(i)} title="Remove">×</button>
			</div>
		{/each}
		<button class="ghost add" onclick={addHeader}>+ header</button>
	</div>

	{#if method !== 'GET' && method !== 'HEAD'}
		<h3>Body</h3>
		<textarea class="body" bind:value={body} placeholder="raw request body — set Content-Type in headers" spellcheck="false"></textarea>
	{/if}
</section>

{#if result}
	<section class="res">
		<header class="rhead">
			{#if 'status' in result}
				<span class="status {statusClass}">{result.status} {result.statusText}</span>
			{:else}
				<span class="status sx-bad">error</span>
			{/if}
			<span class="muted small">{result.ms} ms</span>
			{#if 'snippet' in result && result.snippet}
				<button class="ghost copy" class:flash={copyFlash} onclick={copySnippet}>{copyFlash ? '✓ copied' : 'copy body'}</button>
			{/if}
		</header>

		{#if 'error' in result}
			<pre class="snippet err">{result.error}</pre>
		{:else}
			{#if Object.keys(result.headers).length > 0}
				<h3>Response headers</h3>
				<table>
					<tbody>
						{#each Object.entries(result.headers) as [k, v]}
							<tr>
								<td class="mono hk">{k}</td>
								<td class="mono hv">{v}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if prettyBody}
				<h3>Body{result.truncated ? ' (truncated)' : ''}</h3>
				<pre class="snippet">{prettyBody}</pre>
			{:else}
				<p class="muted small">No body returned.</p>
			{/if}
		{/if}
	</section>
{/if}

{#if history.length > 0}
	<section class="hist">
		<header class="hhead">
			<h2>History <span class="muted small">(last {history.length})</span></h2>
			<button class="ghost" onclick={clearHistory}>clear history</button>
		</header>
		<table>
			<thead>
				<tr>
					<th>When</th>
					<th>Method</th>
					<th>URL</th>
					<th>Status</th>
					<th class="num">ms</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each history as h}
					<tr>
						<td class="ts" title={h.at}>{new Date(h.at).toLocaleTimeString()}</td>
						<td class="mono">{h.method}</td>
						<td class="mono url-cell" title={h.url}>{h.url}</td>
						<td>
							{#if h.status != null}
								<span class="status-mini" class:ok={h.ok} class:bad={!h.ok}>{h.status}</span>
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td class="num">{h.ms}</td>
						<td><button class="ghost recall" onclick={() => recall(h)}>recall</button></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<style>
	.header { display: flex; justify-content: space-between; gap: 1rem; }
	.header h1 { margin: 0; }
	.small { font-size: 0.85rem; }

	.req {
		margin-top: 1rem;
		padding: 0.85rem 1rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
	}
	.req h3 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin: 0.85rem 0 0.4rem; }

	.line { display: flex; gap: 0.4rem; align-items: stretch; }
	.line select {
		font: inherit; font-size: 0.85rem;
		padding: 0.5rem 0.7rem;
		background: var(--bg); border: 1px solid var(--rule);
		color: var(--fg); border-radius: 6px;
	}
	.url {
		flex: 1 1 auto; font: inherit; font-family: var(--font-mono); font-size: 0.86rem;
		padding: 0.5rem 0.8rem;
		background: var(--bg); border: 1px solid var(--rule);
		color: var(--fg); border-radius: 6px;
	}
	.url:focus, .line select:focus { outline: none; border-color: var(--accent); }

	.send {
		font: inherit; font-size: 0.86rem; padding: 0.5rem 1.1rem;
		background: var(--accent); color: var(--invert-fg); border: 0;
		border-radius: 6px; cursor: pointer; font-weight: 500;
	}
	.send:hover:not(:disabled) { background: var(--accent-d); }
	.send:disabled { opacity: 0.5; cursor: wait; }

	.ghost { font: inherit; font-size: 0.85rem; padding: 0.45rem 0.85rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.ghost:disabled { opacity: 0.5; cursor: not-allowed; }
	.ghost.add { font-size: 0.78rem; padding: 0.3rem 0.6rem; }

	.hdrs { display: flex; flex-direction: column; gap: 0.4rem; }
	.hrow { display: flex; gap: 0.4rem; align-items: center; }
	.hrow input[type="checkbox"] { accent-color: var(--accent); }
	.hk, .hv {
		flex: 1 1 0; font: inherit; font-family: var(--font-mono); font-size: 0.82rem;
		padding: 0.35rem 0.55rem;
		background: var(--bg); border: 1px solid var(--rule);
		color: var(--fg); border-radius: 5px;
	}
	.hk { flex: 0 1 220px; }
	.hk:focus, .hv:focus { outline: none; border-color: var(--accent); }
	.x {
		font: inherit; font-size: 1rem; line-height: 1;
		padding: 0.2rem 0.55rem;
		background: transparent; border: 1px solid var(--rule); color: var(--muted);
		border-radius: 4px; cursor: pointer;
	}
	.x:hover { color: #fb7185; border-color: #fb7185; }

	.body {
		width: 100%; min-height: 12rem; padding: 0.6rem 0.75rem;
		font: 0.82rem var(--font-mono);
		background: var(--code-bg, #0a0c10); color: var(--code-fg, #e2e8f0);
		border: 1px solid var(--rule); border-radius: 6px;
		resize: vertical; white-space: pre; tab-size: 2;
	}
	.body:focus { outline: none; border-color: var(--accent); }

	.res {
		margin-top: 1rem;
		padding: 0.85rem 1rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
	}
	.res h3 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin: 0.85rem 0 0.4rem; }
	.rhead { display: flex; gap: 0.6rem; align-items: center; }
	.copy { margin-left: auto; transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast); }
	.copy.flash { color: #6ee7b7; border-color: #6ee7b7; background: rgba(110, 231, 183, 0.12); }
	.status {
		display: inline-block; padding: 0.15rem 0.55rem; border-radius: 4px;
		font-family: var(--font-mono); font-size: 0.8rem;
		border: 1px solid var(--rule); color: var(--fg-soft);
	}
	.status.sx-ok { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.status.sx-info { color: #93c5fd; border-color: rgba(147, 197, 253, 0.4); }
	.status.sx-warn { color: #fcd34d; border-color: rgba(252, 211, 77, 0.4); }
	.status.sx-bad { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }

	table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
	td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: top; }
	tr:last-child td { border-bottom: 0; }
	td.mono { font-family: var(--font-mono); font-size: 0.92em; color: var(--fg); }
	td.hk { width: 220px; word-break: break-all; }
	td.hv { word-break: break-all; }

	.snippet {
		margin: 0;
		padding: 0.7rem 0.85rem;
		background: var(--code-bg, #0a0c10); color: var(--code-fg, #e2e8f0);
		border-radius: 6px;
		font-family: var(--font-mono); font-size: 0.82rem;
		max-height: 60vh; overflow: auto; white-space: pre-wrap; word-break: break-all;
	}
	.snippet.err { color: #fb7185; }

	.hist {
		margin-top: 1rem; padding: 0.85rem 1rem;
		background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px;
	}
	.hhead { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: 0.4rem; }
	.hhead h2 { margin: 0; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.hist table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
	.hist th { text-align: left; padding: 0.3rem 0.55rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	.hist th.num, .hist td.num { text-align: right; }
	.hist td { padding: 0.4rem 0.55rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: middle; }
	.hist tr:last-child td { border-bottom: 0; }
	.hist td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.92em; }
	.hist td.url-cell { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.hist td.ts { color: var(--muted); white-space: nowrap; font-family: var(--font-mono); font-size: 0.85em; }
	.hist .recall { font-size: 0.75rem; padding: 0.2rem 0.55rem; }
	.status-mini {
		display: inline-block; padding: 0.05rem 0.4rem; border-radius: 3px;
		font-family: var(--font-mono); font-size: 0.78em;
		border: 1px solid var(--rule);
	}
	.status-mini.ok { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.status-mini.bad { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }
</style>
