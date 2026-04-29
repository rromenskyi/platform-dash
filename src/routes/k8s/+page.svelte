<script lang="ts">
	let { data } = $props();
</script>

<h1>K8s Overview</h1>
<p class="muted">Cluster-wide health + entry points to deeper views.</p>

<section class="grid">
	<a class="card" href="/k8s/workloads">
		<h2>Workloads</h2>
		<p>Pods, Deployments, StatefulSets across every namespace. Filter by ns, label, status.</p>
	</a>

	<a class="card" href="/k8s/nodes">
		<h2>Nodes</h2>
		<p>Node capacity, allocatable, taints, labels, hosted Pods.</p>
	</a>

	<a class="card" href="/k8s/monitoring">
		<h2>Monitoring</h2>
		<p>Prometheus + Grafana surface — health rollup, latency, errors.</p>
	</a>

	<a class="card external" href="https://grafana.ipsupport.us" rel="noopener" target="_blank">
		<h2>Open Grafana ↗</h2>
		<p>Direct deeplink to the kube-prometheus-stack Grafana for the platform.</p>
	</a>
</section>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
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
</style>
