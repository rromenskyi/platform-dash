<script lang="ts">
	let { data } = $props();
</script>

<h1>Clusters</h1>
<p class="muted">{data.rollups.length} configured · pick a cluster to explore.</p>

<section class="grid">
	{#each data.rollups as r}
		<a class="card" class:bad={!r.reachable} href={r.canRead ? `/k8s/${r.name}` : '#'} aria-disabled={!r.canRead}>
			<header>
				<h2>{r.name}</h2>
				{#if !r.reachable}
					<span class="status bad">unreachable</span>
				{:else}
					<span class="status ok">reachable</span>
				{/if}
			</header>
			{#if r.error}
				<p class="err">{r.error}</p>
			{:else if r.reachable && r.nodes && r.pods}
				<div class="metrics">
					<div><span class="k">Nodes</span><span class="v">{r.nodes.ready}/{r.nodes.total}</span></div>
					<div><span class="k">Namespaces</span><span class="v">{r.namespaces ?? '—'}</span></div>
					<div><span class="k">Pods</span><span class="v">{r.pods.running}/{r.pods.total}</span></div>
					{#if r.pods.failed > 0}
						<div><span class="k">Failed</span><span class="v bad">{r.pods.failed}</span></div>
					{/if}
				</div>
			{/if}
		</a>
	{/each}
</section>

<style>
	.muted { color: var(--muted); margin-bottom: 1rem; }
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}
	.card {
		display: block;
		padding: 1rem 1.1rem;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-elev);
		color: var(--fg);
		transition: border-color var(--t-fast), transform var(--t-fast);
	}
	.card:hover { border-color: var(--accent); transform: translateY(-1px); }
	.card.bad { border-color: #fb7185; }
	.card header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; }
	.card h2 { font-family: var(--font-mono); font-size: 1.05rem; margin: 0; }
	.status { font-size: 0.7rem; padding: 0.05rem 0.5rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
	.status.ok { color: #6ee7b7; border: 1px solid #6ee7b7; }
	.status.bad { color: #fb7185; border: 1px solid #fb7185; }
	.err { font-size: 0.78rem; color: #fb7185; word-break: break-word; }
	.metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4rem 0.85rem; font-size: 0.85rem; }
	.metrics .k { display: block; color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	.metrics .v { color: var(--fg); font-family: var(--font-display); font-weight: 600; }
	.metrics .v.bad { color: #fb7185; }
</style>
