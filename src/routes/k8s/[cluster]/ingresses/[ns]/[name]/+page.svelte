<script lang="ts">
	import { age } from '$lib/k8s';
	import KubectlMenu from '$lib/KubectlMenu.svelte';

	let { data } = $props();
	let showAnnotations = $state(false);

	const labelEntries = $derived(Object.entries(data.ing.labels));
	const annoEntries = $derived(Object.entries(data.ing.annotations));
</script>

<p class="crumb"><a href="/k8s/{data.cluster}/ingresses">← Ingresses</a></p>

<div class="header">
	<div>
		<h1>{data.name}</h1>
		<p class="muted small">
			ns <code>{data.ns}</code>
			· class <code>{data.ing.className ?? '—'}</code>
			· age {age(data.ing.creationTimestamp)}
			· {data.ing.rules.length} rule{data.ing.rules.length === 1 ? '' : 's'}
			{#if data.ing.tlsHosts.length > 0}· {data.ing.tlsHosts.length} TLS host{data.ing.tlsHosts.length === 1 ? '' : 's'}{/if}
		</p>
	</div>
	<KubectlMenu target={{ cluster: data.cluster, kind: 'Ingress', namespace: data.ns, name: data.name }} />
</div>

{#if data.ing.lbIngress.length > 0}
	<section class="stats">
		{#each data.ing.lbIngress as i}
			<div class="stat">
				<span class="label">LoadBalancer</span>
				<span class="value mono">{i.ip ?? i.hostname ?? '—'}</span>
			</div>
		{/each}
	</section>
{/if}

<section class="card">
	<h2>Rules → backend</h2>
	{#if data.ing.rules.length === 0 && !data.ing.defaultBackend}
		<p class="muted small">No rules and no default backend — this ingress matches nothing.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Host</th>
					<th>Path</th>
					<th>Path type</th>
					<th>Service</th>
					<th>Port</th>
				</tr>
			</thead>
			<tbody>
				{#each data.ing.rules as r}
					<tr>
						<td class="mono">
							{#if r.host}
								<a href="https://{r.host}{r.path}" rel="noopener" target="_blank">{r.host}</a>
							{:else}
								<span class="muted">*</span>
							{/if}
						</td>
						<td class="mono small">{r.path}</td>
						<td class="mono small">{r.pathType ?? '—'}</td>
						<td class="mono">
							<a href="/k8s/{data.cluster}/services/{data.ns}/{r.service}">{r.service}</a>
						</td>
						<td class="mono small">{r.port || '—'}</td>
					</tr>
				{/each}
				{#if data.ing.defaultBackend}
					<tr>
						<td class="muted"><em>default backend</em></td>
						<td>—</td>
						<td>—</td>
						<td class="mono">
							<a href="/k8s/{data.cluster}/services/{data.ns}/{data.ing.defaultBackend.service}">{data.ing.defaultBackend.service}</a>
						</td>
						<td class="mono small">{data.ing.defaultBackend.port || '—'}</td>
					</tr>
				{/if}
			</tbody>
		</table>
	{/if}
</section>

{#if data.ing.tlsHosts.length > 0}
	<section class="card">
		<h2>TLS hosts</h2>
		<div class="kvs">
			{#each data.ing.tlsHosts as h}
				<span class="lbl">{h}</span>
			{/each}
		</div>
	</section>
{/if}

{#if labelEntries.length > 0 || annoEntries.length > 0}
	<section class="card">
		<h2>
			Labels
			{#if annoEntries.length > 0}
				<button class="link" type="button" onclick={() => (showAnnotations = !showAnnotations)}>
					{showAnnotations ? 'hide' : 'show'} {annoEntries.length} annotation{annoEntries.length === 1 ? '' : 's'}
				</button>
			{/if}
		</h2>
		{#if labelEntries.length === 0}
			<p class="muted small">No labels.</p>
		{:else}
			<div class="kvs">
				{#each labelEntries as [k, v]}
					<span class="lbl">{k}={v}</span>
				{/each}
			</div>
		{/if}
		{#if showAnnotations}
			<h3>Annotations</h3>
			<div class="kvs">
				{#each annoEntries as [k, v]}
					<span class="lbl wrap">{k}={v}</span>
				{/each}
			</div>
		{/if}
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

	.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
	.stat { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.75rem 0.9rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px; }
	.stat .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.stat .value { font-size: 0.95rem; color: var(--fg); }
	.stat .value.mono { font-family: var(--font-mono); font-size: 0.85em; }

	.card { margin-top: 1rem; padding: 0.85rem 1rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg-elev); }
	.card h2 { margin: 0 0 0.5rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.card h3 { margin: 0.75rem 0 0.4rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }

	table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
	th { text-align: left; padding: 0.4rem 0.6rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: top; }
	tr:last-child td { border-bottom: 0; }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.mono a { color: var(--fg); }
	td.mono a:hover { color: var(--accent); }
	td.small { font-size: 0.78em; }

	.kvs { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.lbl { display: inline-block; padding: 0.1rem 0.45rem; background: var(--bg); border: 1px solid var(--rule); border-radius: 3px; color: var(--fg); font-family: var(--font-mono); font-size: 0.78rem; }
	.lbl.wrap { word-break: break-all; max-width: 100%; }

	.link { background: transparent; border: 0; padding: 0; margin-left: 0.5rem; color: var(--accent); cursor: pointer; font: inherit; font-size: 0.78rem; text-transform: none; letter-spacing: 0; }
	.link:hover { color: var(--accent-d); }

	td.ts { color: var(--muted); white-space: nowrap; font-family: var(--font-mono); font-size: 0.85em; }
	td.msg { color: var(--muted); font-family: var(--font-mono); font-size: 0.85em; max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.outcome { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 3px; font-family: var(--font-mono); font-size: 0.78em; border: 1px solid var(--rule); color: var(--fg-soft); }
	.outcome-ok { color: #6ee7b7; border-color: rgba(110, 231, 183, 0.4); }
	.outcome-denied { color: #fcd34d; border-color: rgba(252, 211, 77, 0.4); }
	.outcome-error { color: #fb7185; border-color: rgba(251, 113, 133, 0.4); }
</style>
