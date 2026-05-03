<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let refreshing = $state(false);
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	function fmtAge(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		return `${m}m ${s % 60}s`;
	}
</script>

<div class="header">
	<h1>Monitoring <span class="cluster-tag">{data.cluster}</span></h1>
	<button class="ghost" onclick={refresh} disabled={refreshing}>
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

<p class="muted small">
	Quick health rollup + a deeplink to the platform's Grafana stack for the time-series view.
</p>

<section class="cards">
	<div class="card">
		<h3>k8s API ring (in-process)</h3>
		<div class="grid">
			<div class="stat">
				<span class="lbl">Samples</span>
				<span class="val">{data.apiRing.count}</span>
			</div>
			<div class="stat">
				<span class="lbl">Errors</span>
				<span class="val" class:bad={data.apiRing.errors > 0}>{data.apiRing.errors}</span>
			</div>
			<div class="stat">
				<span class="lbl">p50</span>
				<span class="val">{data.apiRing.p50}<span class="of">ms</span></span>
			</div>
			<div class="stat">
				<span class="lbl">p95</span>
				<span class="val">{data.apiRing.p95}<span class="of">ms</span></span>
			</div>
			<div class="stat">
				<span class="lbl">p99</span>
				<span class="val">{data.apiRing.p99}<span class="of">ms</span></span>
			</div>
			<div class="stat">
				<span class="lbl">Window</span>
				<span class="val">{fmtAge(data.apiRing.maxAgeMs)}</span>
			</div>
		</div>
		<p class="muted small note">
			In-process latency for k8s API calls the dash itself made. Resets on pod restart. <a class="link" href="/admin/metrics">/admin/metrics →</a>
		</p>
	</div>

	<div class="card">
		<h3>Stuck-state on this cluster</h3>
		{#if data.clusterStuck}
			<div class="grid">
				<div class="stat">
					<span class="lbl">Failing pods</span>
					<span class="val" class:bad={data.clusterStuck.failing > 0}>{data.clusterStuck.failing}</span>
				</div>
				<div class="stat">
					<span class="lbl">Bad nodes</span>
					<span class="val" class:bad={data.clusterStuck.badNodes > 0}>{data.clusterStuck.badNodes}</span>
				</div>
				<div class="stat">
					<span class="lbl">Reachable</span>
					<span class="val" class:bad={!data.clusterStuck.reachable}>{data.clusterStuck.reachable ? 'yes' : 'no'}</span>
				</div>
			</div>
			<p class="muted small note">
				Same heuristics as the topbar Incident pill. Cached 30s server-side. <a class="link" href="/incident">/incident →</a>
			</p>
		{:else}
			<p class="muted small">No snapshot yet — open /incident to seed it.</p>
		{/if}
	</div>

	<div class="card">
		<h3>Grafana</h3>
		<p>The platform runs a kube-prometheus-stack; long-window metrics, dashboards and alert rules live there.</p>
		<p>
			<a class="link" href={data.grafanaUrl} rel="noopener" target="_blank">{data.grafanaUrl} ↗</a>
		</p>
	</div>
</section>

{#if data.apiRing.perOp.length > 0}
	<section>
		<h2>k8s API: top operations</h2>
		<table>
			<thead>
				<tr>
					<th>Operation</th>
					<th class="num">Count</th>
					<th class="num">Errors</th>
					<th class="num">p50</th>
					<th class="num">p95</th>
				</tr>
			</thead>
			<tbody>
				{#each data.apiRing.perOp.slice(0, 15) as r}
					<tr>
						<td class="mono">{r.op}</td>
						<td class="num">{r.count}</td>
						<td class="num" class:bad={r.errors > 0}>{r.errors}</td>
						<td class="num">{r.p50}<span class="unit">ms</span></td>
						<td class="num">{r.p95}<span class="unit">ms</span></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<style>
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.cluster-tag { font-family: var(--font-mono); font-size: 0.78em; color: var(--accent); margin-left: 0.5rem; }
	.ghost { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.spin { display: inline-block; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.small { font-size: 0.85rem; }
	.note { margin-top: 0.6rem; }

	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin: 1rem 0 2rem; }
	.card { padding: 0.85rem 1rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 10px; }
	.card h3 { margin: 0 0 0.5rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.card p { margin: 0.5rem 0; }

	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 0.5rem; }
	.stat { display: flex; flex-direction: column; gap: 0.05rem; padding: 0.45rem 0.55rem; background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; }
	.stat .lbl { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.stat .val { font-family: var(--font-display); font-size: 1.05rem; font-weight: 600; color: var(--fg); }
	.stat .val.bad { color: #fb7185; }
	.stat .val .of { font-size: 0.7em; font-weight: 400; color: var(--muted); margin-left: 0.1rem; }

	h2 { font-size: 1rem; margin-top: 1.5rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin-top: 0.5rem; }
	th { text-align: left; padding: 0.4rem 0.6rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.bad { color: #fb7185; }
	.unit { color: var(--muted); margin-left: 0.15rem; font-size: 0.85em; }

	.link { color: var(--accent); }
</style>
