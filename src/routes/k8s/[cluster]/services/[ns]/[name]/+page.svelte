<script lang="ts">
	import { age } from '$lib/k8s';
	import KubectlMenu from '$lib/KubectlMenu.svelte';

	let { data } = $props();

	const selectorEntries = $derived(Object.entries(data.svc.selector));
	const labelEntries = $derived(Object.entries(data.svc.labels));
	const readyCount = $derived(data.endpoints.filter((e) => e.ready).length);
</script>

<p class="crumb"><a href="/k8s/{data.cluster}/services">← Services</a></p>

<div class="header">
	<div>
		<h1>{data.name}</h1>
		<p class="muted small">
			ns <code>{data.ns}</code>
			· <span class="type type-{data.svc.type.toLowerCase()}">{data.svc.type}</span>
			· age {age(data.svc.creationTimestamp)}
			· {readyCount} of {data.endpoints.length} endpoint{data.endpoints.length === 1 ? '' : 's'} ready
		</p>
	</div>
	<KubectlMenu target={{ cluster: data.cluster, kind: 'Service', namespace: data.ns, name: data.name }} />
</div>

<section class="stats">
	<div class="stat">
		<span class="label">ClusterIP</span>
		<span class="value mono">{data.svc.clusterIP}</span>
		{#if data.svc.clusterIPs.length > 1}
			<span class="hint">+ {data.svc.clusterIPs.slice(1).join(', ')}</span>
		{/if}
	</div>
	{#if data.svc.externalIPs.length > 0}
		<div class="stat">
			<span class="label">External IPs</span>
			<span class="value mono">{data.svc.externalIPs.join(', ')}</span>
		</div>
	{/if}
	{#if data.svc.loadBalancerIP}
		<div class="stat">
			<span class="label">LoadBalancer</span>
			<span class="value mono">{data.svc.loadBalancerIP}</span>
		</div>
	{/if}
	{#if data.svc.sessionAffinity && data.svc.sessionAffinity !== 'None'}
		<div class="stat">
			<span class="label">Session affinity</span>
			<span class="value mono">{data.svc.sessionAffinity}</span>
		</div>
	{/if}
	{#if data.svc.externalTrafficPolicy}
		<div class="stat">
			<span class="label">External traffic</span>
			<span class="value mono">{data.svc.externalTrafficPolicy}</span>
		</div>
	{/if}
</section>

<section class="card">
	<h2>Ports</h2>
	{#if data.ports.length === 0}
		<p class="muted small">No ports.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th class="num">Port</th>
					<th>Protocol</th>
					<th>Target</th>
					<th class="num">NodePort</th>
				</tr>
			</thead>
			<tbody>
				{#each data.ports as p}
					<tr>
						<td class="mono">{p.name ?? '—'}</td>
						<td class="num">{p.port}</td>
						<td class="mono small">{p.protocol}</td>
						<td class="mono small">{p.targetPort ?? '—'}</td>
						<td class="num">{p.nodePort ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section class="card">
	<h2>Selector</h2>
	{#if selectorEntries.length === 0}
		<p class="muted small">Headless / external — no selector. Endpoints (if any) are managed externally.</p>
	{:else}
		<div class="kvs">
			{#each selectorEntries as [k, v]}
				<span class="lbl">{k}={v}</span>
			{/each}
		</div>
		<p class="muted small">
			<a class="link" href="/k8s/{data.cluster}/workloads?ns={encodeURIComponent(data.ns)}">→ matching pods (filter manually by label)</a>
		</p>
	{/if}
</section>

<section class="card">
	<h2>Endpoints <span class="muted small">(target pods routed to)</span></h2>
	{#if data.endpointsError}
		<p class="error">Failed to read Endpoints: {data.endpointsError}</p>
	{:else if data.endpoints.length === 0}
		<p class="muted small">No backing endpoints. Service is unreachable until at least one pod matches the selector.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>IP</th>
					<th>Ready</th>
					<th>Node</th>
					<th>Target</th>
				</tr>
			</thead>
			<tbody>
				{#each data.endpoints as e}
					<tr class:not-ready={!e.ready}>
						<td class="mono">{e.ip}</td>
						<td>{e.ready ? '✓' : '—'}</td>
						<td class="mono small">{e.nodeName ?? '—'}</td>
						<td class="mono">
							{#if e.targetRef?.kind === 'Pod' && e.targetRef.name}
								<a href="/k8s/{data.cluster}/pod/{e.targetRef.namespace ?? data.ns}/{e.targetRef.name}">{e.targetRef.kind}/{e.targetRef.name}</a>
							{:else if e.targetRef?.kind && e.targetRef?.name}
								{e.targetRef.kind}/{e.targetRef.name}
							{:else}
								—
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

{#if labelEntries.length > 0}
	<section class="card">
		<h2>Labels</h2>
		<div class="kvs">
			{#each labelEntries as [k, v]}
				<span class="lbl">{k}={v}</span>
			{/each}
		</div>
	</section>
{/if}

{#if data.scopedAudit.length > 0}
	<section class="card">
		<h2>Recent actions <span class="muted small">(audit ring)</span></h2>
		<table>
			<thead><tr><th>When</th><th>User</th><th>Action</th><th>Outcome</th><th class="num">ms</th><th>Message</th></tr></thead>
			<tbody>
				{#each data.scopedAudit as a}
					<tr>
						<td class="ts">{age(a.ts)}</td>
						<td class="mono">{a.user}</td>
						<td class="mono">{a.action}</td>
						<td><span class="outcome outcome-{a.outcome}">{a.outcome}</span></td>
						<td class="num">{a.durationMs ?? ''}</td>
						<td class="msg">{a.message ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<style>
	.crumb { font-size: 0.85rem; margin: 0 0 1rem; }
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }
	.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
	.header h1 { margin: 0; }
	.small { font-size: 0.85rem; }
	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }

	.type { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 4px; font-size: 0.78em; background: var(--bg-elev); font-family: var(--font-mono); }
	.type-clusterip { color: var(--muted); }
	.type-nodeport { color: #fcd34d; }
	.type-loadbalancer { color: #6ee7b7; }
	.type-externalname { color: #a5b4fc; }

	.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
	.stat { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.75rem 0.9rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px; }
	.stat .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.stat .value { font-size: 0.95rem; color: var(--fg); }
	.stat .value.mono { font-family: var(--font-mono); font-size: 0.85em; }
	.stat .hint { font-size: 0.78rem; color: var(--muted); margin-top: 0.15rem; }

	.card { margin-top: 1rem; padding: 0.85rem 1rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg-elev); }
	.card h2 { margin: 0 0 0.5rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }

	table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
	th { text-align: left; padding: 0.4rem 0.6rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: top; }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.mono a { color: var(--fg); }
	td.mono a:hover { color: var(--accent); }
	td.small { font-size: 0.78em; }
	tr.not-ready td { opacity: 0.6; }
	tr:last-child td { border-bottom: 0; }

	.kvs { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.lbl { display: inline-block; padding: 0.1rem 0.45rem; background: var(--bg); border: 1px solid var(--rule); border-radius: 3px; color: var(--fg); font-family: var(--font-mono); font-size: 0.78rem; }

	.link { color: var(--accent); }
	td.ts { color: var(--muted); white-space: nowrap; font-family: var(--font-mono); font-size: 0.85em; }
	td.msg { color: var(--muted); font-family: var(--font-mono); font-size: 0.85em; max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.outcome { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 3px; font-family: var(--font-mono); font-size: 0.78em; border: 1px solid var(--rule); color: var(--fg-soft); }
	.outcome-ok { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.outcome-denied { color: #fcd34d; border-color: rgba(252, 211, 77, 0.4); }
	.outcome-error { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }
	.error { padding: 0.6rem 0.85rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 6px; color: #fb7185; font-size: 0.85rem; }
</style>
