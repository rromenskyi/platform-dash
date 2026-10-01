<script lang="ts">
	let { data } = $props();
	const s = $derived(data.summary);
	const c = $derived(data.cluster);

	function fmtMilli(m: number): string {
		if (m < 1) return `${m.toFixed(2)} m`;
		if (m < 1000) return `${Math.round(m)} m`;
		return `${(m / 1000).toFixed(2)} cores`;
	}
	function fmtBytes(b: number): string {
		if (b < 1024) return `${b} B`;
		if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} Ki`;
		if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} Mi`;
		return `${(b / 1024 ** 3).toFixed(2)} Gi`;
	}

	const topByCpu = $derived(
		[...data.topPods].sort((a, b) => b.cpuMilli - a.cpuMilli).slice(0, 5)
	);
	const topByMem = $derived(
		[...data.topPods].sort((a, b) => b.memBytes - a.memBytes).slice(0, 5)
	);
</script>

<h1>K8s Overview <span class="cluster-tag">{c}</span></h1>
<p class="muted">Cluster-wide health rollup, with deeplinks into the per-resource views.</p>

<section class="stats">
	<div class="stat">
		<span class="label">Nodes</span>
		<span class="value">{s.nodes.ready}<span class="of">/{s.nodes.total}</span></span>
		<span class="hint">Ready</span>
	</div>
	<div class="stat">
		<span class="label">Namespaces</span>
		<span class="value">{s.namespaces}</span>
		<span class="hint">Total</span>
	</div>
	<div class="stat">
		<span class="label">Pods</span>
		<span class="value">{s.pods.running}<span class="of">/{s.pods.total}</span></span>
		<span class="hint">
			Running
			{#if s.pods.pending > 0}<em>· {s.pods.pending} pending</em>{/if}
			{#if s.pods.failed > 0}<em class="bad">· {s.pods.failed} failed</em>{/if}
		</span>
	</div>
	<div class="stat">
		<span class="label">Deployments</span>
		<span class="value">{s.deployments.ready}<span class="of">/{s.deployments.total}</span></span>
		<span class="hint">Ready</span>
	</div>
	<div class="stat">
		<span class="label">CRDs</span>
		<span class="value">{s.crds}</span>
		<span class="hint">Installed</span>
	</div>
</section>

{#if data.metricsAvailable && data.topPods.length > 0}
	<section class="top">
		<div class="top-card">
			<h3>Top CPU</h3>
			<table>
				<thead><tr><th>Pod</th><th class="num">CPU</th></tr></thead>
				<tbody>
					{#each topByCpu as p}
						<tr>
							<td class="mono">
								<a href="/k8s/{c}/pod/{p.namespace}/{p.name}">{p.namespace}/{p.name}</a>
							</td>
							<td class="num">{fmtMilli(p.cpuMilli)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="top-card">
			<h3>Top memory</h3>
			<table>
				<thead><tr><th>Pod</th><th class="num">Mem</th></tr></thead>
				<tbody>
					{#each topByMem as p}
						<tr>
							<td class="mono">
								<a href="/k8s/{c}/pod/{p.namespace}/{p.name}">{p.namespace}/{p.name}</a>
							</td>
							<td class="num">{fmtBytes(p.memBytes)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{:else if !data.metricsAvailable}
	<p class="muted small hint">
		Top consumers panel hidden — install metrics-server (or grant the dashboard SA <code>get</code> on
		<code>metrics.k8s.io/v1beta1</code>) to see it.
	</p>
{/if}

<section class="grid">
	<a class="card" href="/k8s/{c}/workloads">
		<h2>Workloads →</h2>
		<p>Pods, Deployments, StatefulSets across every namespace.</p>
	</a>

	<a class="card" href="/k8s/{c}/nodes">
		<h2>Nodes →</h2>
		<p>Node capacity, allocatable, taints, labels, hosted Pods.</p>
	</a>

	<a class="card" href="/k8s/{c}/namespaces">
		<h2>Namespaces →</h2>
		<p>All namespaces with quick deeplinks into workloads / configmaps / secrets.</p>
	</a>

	<a class="card" href="/k8s/{c}/services">
		<h2>Services →</h2>
		<p>Services with type, cluster/external IP, ports.</p>
	</a>

	<a class="card" href="/k8s/{c}/ingresses">
		<h2>Ingresses →</h2>
		<p>Hosts, paths, backend services, TLS.</p>
	</a>

	<a class="card" href="/k8s/{c}/configmaps">
		<h2>ConfigMaps →</h2>
		<p>List + per-key values.</p>
	</a>

	<a class="card" href="/k8s/{c}/secrets">
		<h2>Secrets →</h2>
		<p>Type, keys, reveal-on-click decoded values (audit-logged).</p>
	</a>

	<a class="card" href="/k8s/{c}/jobs">
		<h2>Jobs →</h2>
		<p>Completion / active / failed counts, start + finish times.</p>
	</a>

	<a class="card" href="/k8s/{c}/cronjobs">
		<h2>CronJobs →</h2>
		<p>Schedule, suspend, last run.</p>
	</a>

	<a class="card" href="/k8s/{c}/crds">
		<h2>CRDs →</h2>
		<p>CustomResourceDefinitions and their instances across the cluster.</p>
	</a>

	<a class="card" href="/k8s/{c}/monitoring">
		<h2>Monitoring →</h2>
		<p>Prometheus + Grafana surface — health rollup, latency, errors.</p>
	</a>

	{#if data.grafanaUrl}
		<a class="card external" href={data.grafanaUrl} rel="noopener" target="_blank">
			<h2>Open Grafana ↗</h2>
			<p>Dashboards, long-window metrics and alert rules.</p>
		</a>
	{/if}
</section>

<style>
	.cluster-tag {
		display: inline-block;
		margin-left: 0.5rem;
		padding: 0.05rem 0.55rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: lowercase;
		letter-spacing: 0.04em;
		background: var(--bg-elev);
		color: var(--accent);
		border: 1px solid var(--rule);
		font-family: var(--font-mono);
		vertical-align: middle;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 1rem 1.1rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 10px;
	}

	.stat .label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.stat .value {
		font-family: var(--font-display);
		font-size: 2rem;
		font-weight: 600;
		line-height: 1.1;
		color: var(--fg);
	}

	.stat .value .of {
		font-size: 1.1rem;
		font-weight: 400;
		color: var(--muted);
	}

	.stat .hint {
		font-size: 0.85rem;
		color: var(--fg-soft);
	}
	.stat .hint em {
		font-style: normal;
		color: var(--muted);
	}
	.stat .hint em.bad { color: #fb7185; }

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1rem;
		margin-top: 1.75rem;
	}

	.card {
		display: block;
		padding: 1.25rem 1.25rem 1rem;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-elev);
		color: var(--fg);
		transition: border-color var(--t-fast), transform var(--t-fast);
	}

	.card:hover {
		border-color: var(--muted);
		transform: translateY(-2px);
	}

	.card h2 {
		font-size: 1rem;
		margin: 0 0 0.4rem;
		color: var(--fg);
	}

	.card p {
		font-size: 0.88rem;
		margin: 0;
		color: var(--muted);
	}

	.card.external h2 {
		color: var(--accent);
	}

	.top {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
		margin: 1rem 0 1.5rem;
	}
	.top-card {
		padding: 0.85rem 1rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 10px;
	}
	.top-card h3 {
		margin: 0 0 0.5rem;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
	}
	.top-card table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
	.top-card th { text-align: left; padding: 0.3rem 0.5rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	.top-card th.num, .top-card td.num { text-align: right; }
	.top-card td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	.top-card tr:last-child td { border-bottom: 0; }
	.top-card td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.top-card td.mono a { color: var(--fg); }
	.top-card td.mono a:hover { color: var(--accent); }
	.small { font-size: 0.85rem; }
	/* Paragraph hint below the tables — scoped to <p> so it doesn't also
	   pad the .stat card hints (which made every card ~35px too tall). */
	p.hint { color: var(--muted); margin: 0.5rem 0 1.5rem; }
</style>
