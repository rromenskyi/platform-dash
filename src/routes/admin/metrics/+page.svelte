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
	<h1>k8s API metrics</h1>
	<button class="refresh" onclick={refresh} disabled={refreshing}>
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

<p class="muted small">
	In-memory ring buffer of the most recent {data.metrics.count} k8s API calls
	(window: {fmtAge(data.metrics.maxAgeMs)}). Resets on pod restart.
</p>

<section class="stats">
	<div class="stat">
		<span class="label">Samples</span>
		<span class="value">{data.metrics.count}</span>
	</div>
	<div class="stat">
		<span class="label">Errors</span>
		<span class="value" class:bad={data.metrics.errors > 0}>{data.metrics.errors}</span>
	</div>
	<div class="stat">
		<span class="label">p50</span>
		<span class="value">{data.metrics.p50}<span class="of">ms</span></span>
	</div>
	<div class="stat">
		<span class="label">p95</span>
		<span class="value">{data.metrics.p95}<span class="of">ms</span></span>
	</div>
	<div class="stat">
		<span class="label">p99</span>
		<span class="value">{data.metrics.p99}<span class="of">ms</span></span>
	</div>
</section>

<h2>Per operation</h2>

{#if data.metrics.perOp.length === 0}
	<p class="muted small">No samples yet — visit /k8s pages to populate.</p>
{:else}
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
			{#each data.metrics.perOp as r}
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
{/if}

<style>
	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.refresh {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.refresh:hover:not(:disabled) {
		color: var(--fg);
		border-color: var(--muted);
	}
	.refresh:disabled { cursor: wait; opacity: 0.6; }
	.spin {
		display: inline-block;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 1rem;
		margin: 1.25rem 0 2rem;
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
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--fg);
	}
	.stat .value .of {
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--muted);
		margin-left: 0.15rem;
	}
	.stat .value.bad { color: #fb7185; }

	.small { font-size: 0.85rem; }

	h2 { margin-top: 2rem; font-size: 1rem; }

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
		margin-top: 0.75rem;
	}
	th {
		text-align: left;
		padding: 0.5rem 0.75rem;
		color: var(--muted);
		font-weight: 500;
		border-bottom: 1px solid var(--rule);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	th.num, td.num { text-align: right; }
	td {
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		color: var(--fg-soft);
	}
	tr:hover td { background: var(--bg-elev); }
	td.mono {
		color: var(--fg);
		font-family: var(--font-mono);
		font-size: 0.85em;
	}
	td.bad { color: #fb7185; }
	.unit {
		color: var(--muted);
		margin-left: 0.15rem;
		font-size: 0.85em;
	}
</style>
