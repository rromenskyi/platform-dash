<script lang="ts">
	import { fmtCpu, fmtBytes } from '$lib/quantity';

	let { data } = $props();

	const pct = (used: number | null, of: number) => (used === null || !of ? null : Math.round((used / of) * 100));
	const level = (p: number | null) => (p === null ? '' : p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok');
</script>

{#snippet meter(used: number | null, req: number, lim: number, fmt: (n: number) => string)}
	{@const of = lim || req}
	{@const p = pct(used, of)}
	<div class="meter" title={`used ${used === null ? '—' : fmt(used)} · request ${req ? fmt(req) : '—'} · limit ${lim ? fmt(lim) : '—'}`}>
		<div class="bar"><div class="fill {level(p)}" style="width: {Math.min(p ?? 0, 100)}%"></div></div>
		<span class="num">
			{used === null ? '—' : fmt(used)}
			<span class="muted">/ {of ? fmt(of) : 'no limit'}{lim ? '' : req ? ' req' : ''}</span>
		</span>
	</div>
{/snippet}

<div class="header">
	<h1>Monitoring <span class="cluster-tag">{data.cluster}</span></h1>
</div>

<p class="muted small">
	Live usage against limits (or requests when no limit is set){#if !data.metricsAvailable} — <strong>no usage figures: metrics-server isn't answering</strong>{/if}.
	Long-window history lives in Grafana{#if data.grafanaUrl}: <a class="link" href={data.grafanaUrl} rel="noopener" target="_blank">open ↗</a>{/if}.
</p>

{#if data.error}
	<p class="err">Could not load pods: {data.error}</p>
{:else if data.namespaces.length === 0}
	<p class="muted">No pods in the namespaces you can see.</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>Namespace</th>
				<th class="num">Pods</th>
				<th class="num">Restarts</th>
				<th class="num">OOM 24h</th>
				<th class="wide">CPU</th>
				<th class="wide">Memory</th>
			</tr>
		</thead>
		<tbody>
			{#each data.namespaces as n}
				<tr>
					<td><a class="link" href="/k8s/{data.cluster}/monitoring?ns={encodeURIComponent(n.namespace)}">{n.namespace}</a></td>
					<td class="num">
						{n.running}/{n.pods}{#if n.failing}<span class="badge bad" title="failing pods">{n.failing} failing</span>{/if}
					</td>
					<td class="num" class:warnt={n.restarts > 0}>{n.restarts}</td>
					<td class="num" class:badt={n.oom24h > 0}>{n.oom24h}</td>
					<td>{@render meter(n.cpuUsedMilli, n.cpuRequestMilli, n.cpuLimitMilli, fmtCpu)}</td>
					<td>{@render meter(n.memUsedBytes, n.memRequestBytes, n.memLimitBytes, fmtBytes)}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if data.pods.length > 0}
		<h2>Pods</h2>
		<table>
			<thead>
				<tr>
					<th>Pod</th>
					<th>Status</th>
					<th class="num">Restarts</th>
					<th class="wide">CPU</th>
					<th class="wide">Memory</th>
				</tr>
			</thead>
			<tbody>
				{#each data.pods as p}
					<tr>
						<td class="mono"><a class="link" href="/k8s/{data.cluster}/pod/{p.namespace}/{p.name}">{p.name}</a></td>
						<td>
							<span class:badt={p.failing}>{p.phase}</span>
							{#if p.lastTermination}<span class="badge" class:bad={p.lastTermination === 'OOMKilled'} title="last termination">{p.lastTermination}</span>{/if}
						</td>
						<td class="num" class:warnt={p.restarts > 0}>{p.restarts}</td>
						<td>{@render meter(p.cpuUsedMilli, p.cpuRequestMilli, p.cpuLimitMilli, fmtCpu)}</td>
						<td>{@render meter(p.memUsedBytes, p.memRequestBytes, p.memLimitBytes, fmtBytes)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/if}

<style>
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.cluster-tag { font-family: var(--font-mono); font-size: 0.78em; color: var(--accent); margin-left: 0.5rem; }
	.small { font-size: 0.85rem; }
	.link { color: var(--accent); }
	.err { color: #fb7185; }
	h2 { margin-top: 2rem; font-size: 1.1rem; }

	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 1rem; }
	th { text-align: left; font-size: 0.72rem; color: var(--muted); font-weight: 500; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--rule); }
	td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
	.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.wide { width: 26%; }
	.mono { font-family: var(--font-mono); font-size: 0.82rem; }
	.warnt { color: #fcd34d; }
	.badt { color: #fb7185; }

	.badge { display: inline-block; margin-left: 0.4rem; padding: 0 0.4rem; border: 1px solid var(--rule); border-radius: 4px; font-size: 0.72rem; color: var(--muted); }
	.badge.bad { color: #fb7185; border-color: #fb7185; }

	.meter { display: flex; align-items: center; gap: 0.6rem; }
	.bar { flex: 1; min-width: 60px; height: 6px; background: var(--bg-soft); border-radius: 3px; overflow: hidden; }
	.fill { height: 100%; background: var(--muted); }
	.fill.ok { background: #6ee7b7; }
	.fill.warn { background: #fcd34d; }
	.fill.bad { background: #fb7185; }
	.meter .num { min-width: 9rem; font-size: 0.82rem; }
</style>
