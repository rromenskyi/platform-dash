<script lang="ts">
	let { data } = $props();
</script>

<div class="header">
	<h1>Monitoring <span class="cluster-tag">{data.cluster}</span></h1>
</div>

<p class="muted small">
	Long-window metrics, dashboards and alert rules live in Grafana. This page is a placeholder — richer in-dash views may land here later.
</p>

<section class="card">
	<h3>Grafana</h3>
	<p>kube-prometheus-stack on the platform.</p>
	<p>
		<a class="link" href={data.grafanaUrl} rel="noopener" target="_blank">{data.grafanaUrl} ↗</a>
	</p>
</section>

<p class="muted small footnote">
	See also: <a class="link" href="/admin/metrics">/admin/metrics</a> for dash-internal k8s API latency,
	<a class="link" href="/incident">/incident</a> for the cluster stuck-state snapshot.
</p>

<style>
	.header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.cluster-tag { font-family: var(--font-mono); font-size: 0.78em; color: var(--accent); margin-left: 0.5rem; }
	.small { font-size: 0.85rem; }
	.footnote { margin-top: 1.5rem; }

	.card { padding: 0.85rem 1rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 10px; max-width: 480px; margin: 1rem 0; }
	.card h3 { margin: 0 0 0.5rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.card p { margin: 0.5rem 0; }

	.link { color: var(--accent); }
</style>
