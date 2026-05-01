<script lang="ts">
	import { age } from '$lib/k8s';
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
</script>

<p class="crumb"><a href="/k8s/crds">← CustomResourceDefinitions</a></p>

<div class="header">
	<div>
		<h1>{data.crd.kind}</h1>
		<p class="muted small">
			<code>{data.crd.group}</code> · <code>{data.crd.plural}</code> ·
			<span class="scope scope-{data.crd.scope.toLowerCase()}">{data.crd.scope}</span>
			· created {age(data.crd.creationTimestamp)} ago
		</p>
	</div>
	<button class="refresh" onclick={refresh} disabled={refreshing} title="Refresh">
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

<section class="card">
	<h2>Versions</h2>
	<table>
		<thead>
			<tr>
				<th>Name</th>
				<th>Served</th>
				<th>Storage</th>
				<th>Schema</th>
			</tr>
		</thead>
		<tbody>
			{#each data.crd.versions as v}
				<tr>
					<td class="mono">{v.name}</td>
					<td>{v.served ? 'yes' : '—'}</td>
					<td>{v.storage ? 'yes' : '—'}</td>
					<td>{v.hasSchema ? 'OpenAPI v3' : '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if data.crd.shortNames.length > 0}
		<p class="muted small">Short names: <code>{data.crd.shortNames.join(', ')}</code></p>
	{/if}
</section>

<section class="card">
	<h2>
		Instances
		{#if data.crd.servingVersion}
			<span class="muted small">via <code>{data.crd.servingVersion}</code></span>
		{/if}
	</h2>

	{#if data.instancesError}
		<p class="error">Failed to list instances: {data.instancesError}</p>
	{:else if !data.crd.servingVersion}
		<p class="muted small">No served version — cannot enumerate instances.</p>
	{:else if data.instances.length === 0}
		<p class="muted small">No instances of this kind in the cluster.</p>
	{:else}
		<p class="muted small">{data.instances.length} instance{data.instances.length === 1 ? '' : 's'}</p>
		<table>
			<thead>
				<tr>
					{#if data.crd.scope === 'Namespaced'}
						<th>Namespace</th>
					{/if}
					<th>Name</th>
					<th>Age</th>
				</tr>
			</thead>
			<tbody>
				{#each data.instances as i}
					<tr>
						{#if data.crd.scope === 'Namespaced'}
							<td>{i.namespace ?? '—'}</td>
						{/if}
						<td class="mono">
							<a
								href="/k8s/crds/{data.crd.name}/instance?ns={encodeURIComponent(i.namespace ?? '')}&n={encodeURIComponent(i.name)}"
							>{i.name}</a>
						</td>
						<td>{age(i.creationTimestamp)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.crumb {
		font-size: 0.85rem;
		margin: 0 0 1rem;
	}
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }

	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.header h1 { margin: 0; }
	.header .small { margin-top: 0.25rem; }

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
	.refresh .spin {
		display: inline-block;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.card {
		margin-top: 1.5rem;
		padding: 1.25rem 1.25rem 1rem;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-elev);
	}
	.card h2 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
	}
	.card h2 .small { font-weight: 400; margin-left: 0.5rem; }

	.small { font-size: 0.85rem; }

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
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
	td {
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		color: var(--fg-soft);
	}
	tr:hover td { background: rgba(255, 255, 255, 0.02); }

	td.mono { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }
	td.mono a { color: var(--fg); }
	td.mono a:hover { color: var(--accent); }

	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		color: var(--fg);
	}

	.scope {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--bg);
	}
	.scope-namespaced { color: #a5b4fc; }
	.scope-cluster { color: #c4b5fd; }

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}
</style>
