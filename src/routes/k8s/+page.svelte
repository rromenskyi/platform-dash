<script lang="ts">
	let { data } = $props();
	const s = $derived(data.summary);
</script>

<h1>K8s Overview</h1>
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

<section class="grid">
	<a class="card" href="/k8s/workloads">
		<h2>Workloads →</h2>
		<p>Pods, Deployments, StatefulSets across every namespace.</p>
	</a>

	<a class="card" href="/k8s/nodes">
		<h2>Nodes →</h2>
		<p>Node capacity, allocatable, taints, labels, hosted Pods.</p>
	</a>

	<a class="card" href="/k8s/crds">
		<h2>CRDs →</h2>
		<p>CustomResourceDefinitions and their instances across the cluster.</p>
	</a>

	<a class="card" href="/k8s/monitoring">
		<h2>Monitoring →</h2>
		<p>Prometheus + Grafana surface — health rollup, latency, errors.</p>
	</a>

	<a class="card external" href="https://grafana.ipsupport.us" rel="noopener" target="_blank">
		<h2>Open Grafana ↗</h2>
		<p>Direct deeplink to the kube-prometheus-stack Grafana for the platform.</p>
	</a>
</section>

<style>
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
</style>
