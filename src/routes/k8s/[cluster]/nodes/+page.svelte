<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';
	import type { NodeRow } from './+page.server';

	let { data } = $props();

	let refreshing = $state(false);
	let openLabels = $state<Record<string, boolean>>({});

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	function fmtMilli(m: number): string {
		if (m < 1000) return `${m}m`;
		return `${(m / 1000).toFixed(2)} cores`;
	}

	function fmtBytes(b: number): string {
		const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
		let v = b;
		let i = 0;
		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
	}

	function parseCpuLocal(v: string): number {
		if (!v) return 0;
		if (v.endsWith('m')) return parseInt(v, 10);
		const n = parseFloat(v);
		return Number.isFinite(n) ? n * 1000 : 0;
	}

	function parseMemLocal(v: string): number {
		const m = /^([\d.]+)([a-zA-Z]*)$/.exec(v);
		if (!m) return 0;
		const units: Record<string, number> = {
			Ki: 1024,
			Mi: 1024 ** 2,
			Gi: 1024 ** 3,
			Ti: 1024 ** 4
		};
		return parseFloat(m[1]) * (m[2] ? (units[m[2]] ?? 1) : 1);
	}

	function pct(used: number, total: number): number {
		if (!total) return 0;
		return Math.min(100, Math.round((used / total) * 100));
	}

	function toggleLabels(name: string) {
		openLabels = { ...openLabels, [name]: !openLabels[name] };
	}

	// Most-significant condition for the badge — Ready=False matters
	// more than NotReady-but-Ready=True; PIDPressure / DiskPressure
	// are warnings worth surfacing inline.
	function nodeBadgeColor(n: NodeRow): string {
		if (n.unschedulable) return 'warn';
		if (!n.ready) return 'bad';
		const pressure = n.conditions.find(
			(c) =>
				(c.type === 'MemoryPressure' || c.type === 'DiskPressure' || c.type === 'PIDPressure') &&
				c.status === 'True'
		);
		if (pressure) return 'warn';
		return 'good';
	}
	function nodeBadgeText(n: NodeRow): string {
		if (n.unschedulable) return 'SchedulingDisabled';
		if (!n.ready) return 'NotReady';
		const pressure = n.conditions.find(
			(c) =>
				(c.type === 'MemoryPressure' || c.type === 'DiskPressure' || c.type === 'PIDPressure') &&
				c.status === 'True'
		);
		if (pressure) return pressure.type;
		return 'Ready';
	}
</script>

<div class="header">
	<h1>Nodes</h1>
	<button class="refresh" onclick={refresh} disabled={refreshing}>
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

{#if data.error}
	<p class="error">Failed to list nodes: {data.error}</p>
{/if}

<p class="muted small">
	{data.rows.length} node{data.rows.length === 1 ? '' : 's'}
	{#if data.scopedNs}
		· request totals scoped to ns <code>{data.scopedNs}</code>
	{:else}
		· request totals are cluster-wide
	{/if}
	{#if !data.metricsAvailable}
		· <em>actual usage unavailable (no metrics-server)</em>
	{/if}
</p>

{#each data.rows as n}
	{@const cpuAlloc = parseCpuLocal(n.allocatable.cpu)}
	{@const memAlloc = parseMemLocal(n.allocatable.memory)}
	{@const cpuPct = pct(n.usage.cpuRequestsMilli, cpuAlloc)}
	{@const memPct = pct(n.usage.memoryRequestsBytes, memAlloc)}
	{@const actualCpuPct = n.usage.actualCpuMilli != null ? pct(n.usage.actualCpuMilli, cpuAlloc) : null}
	{@const actualMemPct = n.usage.actualMemoryBytes != null ? pct(n.usage.actualMemoryBytes, memAlloc) : null}
	<section class="node">
		<header class="node-head">
			<div class="node-id">
				<h2>{n.name}</h2>
				<div class="muted small">
					<span class="badge badge-{nodeBadgeColor(n)}">{nodeBadgeText(n)}</span>
					{#each n.roles as r}
						<span class="role">{r}</span>
					{/each}
					· age {age(n.creationTimestamp)}
				</div>
			</div>
			<div class="meta">
				<div><span class="k">internal</span> <code>{n.internalIP ?? '—'}</code></div>
				{#if n.externalIP}
					<div><span class="k">external</span> <code>{n.externalIP}</code></div>
				{/if}
				<div><span class="k">kubelet</span> <code>{n.kubeletVersion ?? '?'}</code></div>
				<div><span class="k">runtime</span> <code>{n.containerRuntime ?? '?'}</code></div>
				<div><span class="k">os</span> <code>{n.osImage ?? '?'}</code></div>
				<div><span class="k">arch</span> <code>{n.architecture ?? '?'}</code></div>
			</div>
		</header>

		<div class="usage">
			<div class="bar-row">
				<span class="bar-label">CPU requests</span>
				<div class="bar"><div class="fill fill-{cpuPct >= 85 ? 'bad' : cpuPct >= 65 ? 'warn' : 'ok'}" style="width: {cpuPct}%"></div></div>
				<span class="bar-num">{fmtMilli(n.usage.cpuRequestsMilli)} / {n.allocatable.cpu} ({cpuPct}%)</span>
			</div>
			{#if actualCpuPct !== null}
				<div class="bar-row">
					<span class="bar-label live">CPU actual</span>
					<div class="bar"><div class="fill fill-{actualCpuPct >= 85 ? 'bad' : actualCpuPct >= 65 ? 'warn' : 'ok'}" style="width: {actualCpuPct}%"></div></div>
					<span class="bar-num">{fmtMilli(n.usage.actualCpuMilli ?? 0)} / {n.allocatable.cpu} ({actualCpuPct}%)</span>
				</div>
			{/if}
			<div class="bar-row">
				<span class="bar-label">Memory requests</span>
				<div class="bar"><div class="fill fill-{memPct >= 85 ? 'bad' : memPct >= 65 ? 'warn' : 'ok'}" style="width: {memPct}%"></div></div>
				<span class="bar-num">{fmtBytes(n.usage.memoryRequestsBytes)} / {fmtBytes(memAlloc)} ({memPct}%)</span>
			</div>
			{#if actualMemPct !== null}
				<div class="bar-row">
					<span class="bar-label live">Memory actual</span>
					<div class="bar"><div class="fill fill-{actualMemPct >= 85 ? 'bad' : actualMemPct >= 65 ? 'warn' : 'ok'}" style="width: {actualMemPct}%"></div></div>
					<span class="bar-num">{fmtBytes(n.usage.actualMemoryBytes ?? 0)} / {fmtBytes(memAlloc)} ({actualMemPct}%)</span>
				</div>
			{/if}
			<div class="bar-row">
				<span class="bar-label">Pods</span>
				<div class="bar"><div class="fill fill-{pct(n.usage.podsScheduled, parseInt(n.allocatable.pods, 10) || 0) >= 85 ? 'bad' : 'ok'}" style="width: {pct(n.usage.podsScheduled, parseInt(n.allocatable.pods, 10) || 0)}%"></div></div>
				<span class="bar-num">{n.usage.podsScheduled} / {n.allocatable.pods}</span>
			</div>
		</div>

		{#if n.taints.length > 0}
			<div class="section">
				<h3>Taints</h3>
				<ul class="taints">
					{#each n.taints as t}
						<li><code>{t.key}{t.value ? `=${t.value}` : ''}:{t.effect}</code></li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if n.conditions.some((c) => c.status === 'True' && c.type !== 'Ready')}
			<div class="section">
				<h3>Conditions</h3>
				<ul class="conds">
					{#each n.conditions.filter((c) => c.type !== 'Ready') as c}
						<li>
							<span class="cond cond-{c.status?.toLowerCase()}">{c.type}={c.status}</span>
							{#if c.reason}<span class="muted small">— {c.reason}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="section">
			<button class="link" onclick={() => toggleLabels(n.name)}>
				{openLabels[n.name] ? '▾' : '▸'} Labels ({Object.keys(n.labels).length})
			</button>
			{#if openLabels[n.name]}
				<dl class="kv">
					{#each Object.entries(n.labels) as [k, v]}
						<dt>{k}</dt>
						<dd>{v}</dd>
					{/each}
				</dl>
			{/if}
		</div>
	</section>
{/each}

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
	.refresh:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.refresh:disabled { cursor: wait; opacity: 0.6; }
	.spin { display: inline-block; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.small { font-size: 0.85rem; }
	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		color: var(--fg);
	}

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}

	.node {
		margin-top: 1.25rem;
		padding: 1rem 1.1rem;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-elev);
	}

	.node-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.node-head h2 {
		margin: 0;
		font-size: 1.1rem;
		font-family: var(--font-mono);
	}

	.meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, max-content));
		gap: 0.2rem 1rem;
		font-size: 0.78rem;
		color: var(--fg-soft);
		text-align: right;
	}
	.meta .k {
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 0.7rem;
		margin-right: 0.3rem;
	}

	.badge {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--bg);
		margin-right: 0.5rem;
	}
	.badge-good { color: #6ee7b7; border: 1px solid #6ee7b7; }
	.badge-warn { color: #fcd34d; border: 1px solid #fcd34d; }
	.badge-bad { color: #fb7185; border: 1px solid #fb7185; }

	.role {
		display: inline-block;
		padding: 0.05rem 0.45rem;
		border-radius: 4px;
		font-size: 0.7rem;
		background: var(--bg);
		color: var(--fg-soft);
		margin-right: 0.3rem;
		font-family: var(--font-mono);
	}

	.usage {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.bar-row {
		display: grid;
		grid-template-columns: 130px 1fr 220px;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.82rem;
	}
	.bar-label {
		color: var(--muted);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.bar-label.live { color: var(--accent); }
	.bar {
		height: 8px;
		background: var(--bg);
		border-radius: 4px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		transition: width 0.2s ease;
	}
	.fill-ok { background: #6ee7b7; }
	.fill-warn { background: #fcd34d; }
	.fill-bad { background: #fb7185; }
	.bar-num {
		text-align: right;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--fg-soft);
	}

	.section { margin-top: 1rem; }
	.section h3 {
		margin: 0 0 0.4rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
	}

	.taints, .conds {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
	}

	.cond {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.72rem;
		background: var(--bg);
	}
	.cond-true { color: #fcd34d; }
	.cond-false { color: #6ee7b7; }
	.cond-unknown { color: #fb7185; }

	.link {
		font: inherit;
		font-size: 0.85rem;
		background: none;
		border: 0;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
	}
	.link:hover { text-decoration: underline; }

	.kv {
		margin: 0.5rem 0 0;
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		font-size: 0.8rem;
	}
	.kv dt { font-family: var(--font-mono); color: var(--muted); }
	.kv dd { margin: 0; font-family: var(--font-mono); color: var(--fg); word-break: break-all; }
</style>
