<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';

	let { data } = $props();

	// 30-second auto-poll. Pauses when the tab is hidden so background
	// tabs don't keep dragging on the DB. Manual Refresh button still
	// works while paused.
	const POLL_MS = 30_000;
	let timer: ReturnType<typeof setInterval> | null = null;
	let visible = $state(typeof document === 'undefined' ? true : !document.hidden);

	function refresh() {
		invalidate(`db:${data.target.name}`);
	}

	function start() {
		stop();
		timer = setInterval(() => {
			if (visible) refresh();
		}, POLL_MS);
	}
	function stop() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	onMount(() => {
		const onVis = () => {
			visible = !document.hidden;
			if (visible) refresh();
		};
		document.addEventListener('visibilitychange', onVis);
		start();
		return () => {
			document.removeEventListener('visibilitychange', onVis);
		};
	});
	onDestroy(stop);

	function fmtBytes(b: number): string {
		const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
		let v = b;
		let i = 0;
		while (v >= 1024 && i < u.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${u[i]}`;
	}
	function fmtUptime(sec: number | undefined): string {
		if (sec == null) return '—';
		const d = Math.floor(sec / 86400);
		const h = Math.floor((sec % 86400) / 3600);
		const m = Math.floor((sec % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}
	function pct(used: number, total: number): number {
		if (!total) return 0;
		return Math.min(100, Math.round((used / total) * 100));
	}
</script>

<p class="crumb"><a href="/db">← Databases</a></p>

<div class="header">
	<div>
		<h1>{data.target.label}</h1>
		<p class="muted small">
			<span class="kind kind-{data.target.kind}">{data.target.kind}</span>
			· <code>{data.target.host}</code>
			{#if data.target.cluster}· cluster <code>{data.target.cluster}</code>{/if}
		</p>
	</div>
	<div class="head-actions">
		<span class="poll-state">{visible ? 'auto-refresh 30s' : 'paused (tab hidden)'}</span>
		<button class="ghost" onclick={refresh}>↻ Refresh</button>
	</div>
</div>

{#if !data.detail.ok}
	<p class="error">DB unreachable: {data.detail.reason}</p>
{:else if data.detail.kind === 'postgres'}
	{@const s = data.detail.stats}
	{#if !s.ok}
		<p class="error">Postgres: {s.error}</p>
	{:else}
		<section class="stats">
			<div class="stat"><span class="label">Total size</span><span class="value">{fmtBytes(s.totalBytes)}</span></div>
			<div class="stat"><span class="label">Connections</span><span class="value">{s.connections.active + s.connections.idle + s.connections.idleInTx + s.connections.other}<span class="of">/{s.connections.max}</span></span><span class="hint">{s.connections.active} active · {s.connections.idle} idle{#if s.connections.idleInTx > 0} · <em class="warn">{s.connections.idleInTx} idle-in-tx</em>{/if}</span></div>
			<div class="stat"><span class="label">Uptime</span><span class="value">{fmtUptime(s.uptimeSec)}</span></div>
			<div class="stat"><span class="label">Replication</span>
				{#if !s.replication}<span class="value">—</span>
				{:else if !s.replication.inRecovery}<span class="value">primary</span>
				{:else}<span class="value">replica<span class="hint"> · lag {s.replication.lagSec ?? '?'}s</span></span>
				{/if}
			</div>
		</section>

		<section class="card">
			<h2>Databases</h2>
			<table>
				<thead><tr><th>Name</th><th class="num">Size</th></tr></thead>
				<tbody>
					{#each s.dbs as d}
						<tr>
							<td class="mono">{d.name}</td>
							<td class="num">{fmtBytes(d.bytes)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		{#if s.version}
			<p class="muted small">Version: <code>{s.version}</code></p>
		{/if}
	{/if}
{:else if data.detail.kind === 'redis'}
	{@const s = data.detail.stats}
	{#if !s.ok}
		<p class="error">Redis: {s.error}</p>
	{:else}
		{@const memPct = pct(s.usedBytes, s.maxBytes)}
		{@const totalHits = s.keyspaceHits + s.keyspaceMisses}
		{@const hitRate = totalHits > 0 ? Math.round((s.keyspaceHits / totalHits) * 100) : 0}
		<section class="stats">
			<div class="stat">
				<span class="label">Memory</span>
				<span class="value">{fmtBytes(s.usedBytes)}{#if s.maxBytes > 0}<span class="of">/{fmtBytes(s.maxBytes)}</span>{/if}</span>
				{#if s.maxBytes > 0}
					<div class="bar"><div class="fill fill-{memPct >= 85 ? 'bad' : memPct >= 65 ? 'warn' : 'ok'}" style="width: {memPct}%"></div></div>
				{/if}
			</div>
			<div class="stat"><span class="label">Clients</span><span class="value">{s.clients}</span></div>
			<div class="stat"><span class="label">Evicted keys</span><span class="value" class:warn={s.evictedKeys > 0}>{s.evictedKeys}</span></div>
			<div class="stat"><span class="label">Hit rate</span><span class="value">{hitRate}%<span class="hint"> · {s.keyspaceHits} hits / {s.keyspaceMisses} miss</span></span></div>
			<div class="stat"><span class="label">Uptime</span><span class="value">{fmtUptime(s.uptimeSec)}</span></div>
			<div class="stat"><span class="label">Role</span><span class="value">{s.role ?? '—'}</span></div>
		</section>

		<section class="card">
			<h2>Keyspace</h2>
			{#if s.keyspace.length === 0}
				<p class="muted small">Empty.</p>
			{:else}
				<table>
					<thead><tr><th>DB</th><th class="num">Keys</th><th class="num">With TTL</th></tr></thead>
					<tbody>
						{#each s.keyspace as k}
							<tr>
								<td class="mono">{k.db}</td>
								<td class="num">{k.keys}</td>
								<td class="num">{k.expires}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		{#if s.version}
			<p class="muted small">Redis {s.version}{#if s.mode}· mode <code>{s.mode}</code>{/if}</p>
		{/if}
	{/if}
{/if}

<style>
	.crumb { font-size: 0.85rem; margin: 0 0 1rem; }
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }

	.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
	.header h1 { margin: 0; }
	.head-actions { display: inline-flex; gap: 0.5rem; align-items: center; }
	.poll-state { font-size: 0.75rem; color: var(--muted); }
	.ghost { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover { color: var(--fg); border-color: var(--muted); }

	.kind { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
	.kind-postgres { color: #93c5fd; border: 1px solid #93c5fd; }
	.kind-redis { color: #fb7185; border: 1px solid #fb7185; }

	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }
	.small { font-size: 0.85rem; }

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.85rem;
		margin: 1rem 0 1.5rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.85rem 1rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 10px;
	}
	.stat .label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
	}
	.stat .value {
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 600;
		color: var(--fg);
	}
	.stat .value .of { font-size: 0.85rem; font-weight: 400; color: var(--muted); }
	.stat .value.warn { color: #fcd34d; }
	.stat .hint { font-size: 0.75rem; color: var(--fg-soft); }
	.stat .hint .warn { color: #fcd34d; }

	.bar {
		margin-top: 0.4rem;
		height: 6px;
		background: var(--bg);
		border-radius: 3px;
		overflow: hidden;
	}
	.fill { height: 100%; transition: width 0.2s ease; }
	.fill-ok { background: #6ee7b7; }
	.fill-warn { background: #fcd34d; }
	.fill-bad { background: #fb7185; }

	.card { margin-top: 1rem; padding: 1rem 1.1rem; border: 1px solid var(--rule); border-radius: 10px; background: var(--bg-elev); }
	.card h2 { margin: 0 0 0.6rem; font-size: 1rem; }

	table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
	th { text-align: left; padding: 0.45rem 0.65rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.5rem 0.65rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	tr:hover td { background: rgba(255, 255, 255, 0.02); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}
</style>
