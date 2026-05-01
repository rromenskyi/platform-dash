<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let refreshing = $state(false);
	let showAnnotations = $state(false);

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	function fmtRes(map: Record<string, string> | undefined): string {
		if (!map) return '—';
		const parts = [];
		if (map.cpu) parts.push(`cpu ${map.cpu}`);
		if (map.memory) parts.push(`mem ${map.memory}`);
		return parts.length ? parts.join(' / ') : '—';
	}
</script>

<p class="crumb">
	<a href="/k8s/{data.cluster}/workloads">← Workloads</a>
</p>

<div class="header">
	<div>
		<h1>{data.pod.name}</h1>
		<p class="muted small">
			ns <code>{data.pod.namespace}</code>
			· <span class="phase phase-{data.pod.phase.toLowerCase()}">{data.pod.phase}</span>
			· age {age(data.pod.creationTimestamp)}
			{#if data.pod.qosClass}· QoS <code>{data.pod.qosClass}</code>{/if}
		</p>
	</div>
	<button class="refresh" onclick={refresh} disabled={refreshing}>
		<span class:spin={refreshing}>↻</span> Refresh
	</button>
</div>

<section class="stats">
	<div class="stat">
		<span class="label">Node</span>
		<span class="value mono">{data.pod.node ?? '—'}</span>
	</div>
	<div class="stat">
		<span class="label">Pod IP</span>
		<span class="value mono">{data.pod.podIP ?? '—'}</span>
	</div>
	<div class="stat">
		<span class="label">Host IP</span>
		<span class="value mono">{data.pod.hostIP ?? '—'}</span>
	</div>
	<div class="stat">
		<span class="label">Started</span>
		<span class="value">{age(data.pod.startTime)}</span>
	</div>
</section>

{#if data.pod.ownerRefs.length > 0}
	<p class="muted small">
		Owned by: {#each data.pod.ownerRefs as o, i}{i ? ', ' : ''}<code>{o.kind}/{o.name}</code>{/each}
	</p>
{/if}

<section class="card">
	<h2>Containers</h2>
	<table>
		<thead>
			<tr>
				<th>Name</th>
				<th>State</th>
				<th>Ready</th>
				<th class="num">Restarts</th>
				<th>Image</th>
				<th>Requests</th>
				<th>Limits</th>
			</tr>
		</thead>
		<tbody>
			{#each data.containers as c}
				<tr>
					<td class="mono">{c.name}</td>
					<td>
						<span class="state state-{c.state.split(' ')[0]}">{c.state}</span>
						{#if c.lastTerminationReason}
							<div class="last-term">
								last: {c.lastTerminationReason}
								{#if c.lastTerminationExitCode !== undefined}(exit {c.lastTerminationExitCode}){/if}
							</div>
						{/if}
					</td>
					<td>{c.ready ? '✓' : '—'}</td>
					<td class="num" class:bad={c.restartCount > 0}>{c.restartCount}</td>
					<td class="mono image">{c.image}</td>
					<td>{fmtRes(c.requests)}</td>
					<td>{fmtRes(c.limits)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section class="card">
	<h2>Volumes & Mounts</h2>
	{#if data.volumes.length === 0}
		<p class="muted small">No volumes.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Volume</th>
					<th>Source</th>
					<th>Mounted into</th>
				</tr>
			</thead>
			<tbody>
				{#each data.volumes as v}
					{@const mounts = data.containers.flatMap((c) =>
						c.mounts.filter((m) => m.name === v.name).map((m) => ({ ...m, container: c.name }))
					)}
					<tr>
						<td class="mono">{v.name}</td>
						<td><span class="badge">{v.sourceKind}</span></td>
						<td>
							{#if mounts.length === 0}
								<span class="muted">—</span>
							{:else}
								{#each mounts as m}
									<div class="mount">
										<code>{m.container}</code>:<code>{m.path}</code>
										{#if m.readOnly}<span class="ro">ro</span>{/if}
									</div>
								{/each}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section class="card">
	<h2>Conditions</h2>
	<table>
		<thead>
			<tr>
				<th>Type</th>
				<th>Status</th>
				<th>Reason</th>
				<th>Since</th>
			</tr>
		</thead>
		<tbody>
			{#each data.conditions as c}
				<tr>
					<td class="mono">{c.type}</td>
					<td>
						<span class="cond cond-{c.status?.toLowerCase()}">{c.status}</span>
					</td>
					<td>{c.reason ?? '—'}</td>
					<td>{age(c.lastTransitionTime)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section class="card">
	<h2>Events <span class="muted small">(involvedObject={data.pod.namespace}/{data.pod.name})</span></h2>
	{#if data.eventsError}
		<p class="error">Failed to list events: {data.eventsError}</p>
	{:else if data.events.length === 0}
		<p class="muted small">No events.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Type</th>
					<th>Reason</th>
					<th>Message</th>
					<th class="num">Count</th>
					<th>Last seen</th>
				</tr>
			</thead>
			<tbody>
				{#each data.events as e}
					<tr class:warn={e.type === 'Warning'}>
						<td><span class="ev-type ev-type-{e.type.toLowerCase()}">{e.type}</span></td>
						<td class="mono">{e.reason}</td>
						<td class="msg">{e.message}</td>
						<td class="num">{e.count}</td>
						<td>{age(e.lastSeen)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section class="card">
	<h2>
		Labels
		{#if Object.keys(data.pod.annotations).length > 0}
			<button
				class="link"
				type="button"
				onclick={() => (showAnnotations = !showAnnotations)}
			>
				{showAnnotations ? 'hide' : 'show'} annotations
			</button>
		{/if}
	</h2>
	{#if Object.keys(data.pod.labels).length === 0}
		<p class="muted small">No labels.</p>
	{:else}
		<dl class="kv">
			{#each Object.entries(data.pod.labels) as [k, v]}
				<dt>{k}</dt>
				<dd>{v}</dd>
			{/each}
		</dl>
	{/if}
	{#if showAnnotations && Object.keys(data.pod.annotations).length > 0}
		<h3>Annotations</h3>
		<dl class="kv">
			{#each Object.entries(data.pod.annotations) as [k, v]}
				<dt>{k}</dt>
				<dd class="ann">{v}</dd>
			{/each}
		</dl>
	{/if}
</section>

<style>
	.crumb { font-size: 0.85rem; margin: 0 0 1rem; }
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
	.refresh:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.refresh:disabled { cursor: wait; opacity: 0.6; }
	.spin { display: inline-block; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
		margin: 1rem 0 0.75rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.9rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 8px;
	}
	.stat .label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
	}
	.stat .value {
		font-size: 0.95rem;
		color: var(--fg);
	}
	.stat .value.mono {
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}

	.card {
		margin-top: 1.25rem;
		padding: 1rem 1.1rem;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-elev);
	}
	.card h2 {
		margin: 0 0 0.6rem;
		font-size: 1rem;
	}
	.card h3 {
		margin: 1rem 0 0.5rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
	}

	.small { font-size: 0.85rem; }

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	th {
		text-align: left;
		padding: 0.45rem 0.65rem;
		color: var(--muted);
		font-weight: 500;
		border-bottom: 1px solid var(--rule);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	th.num, td.num { text-align: right; }
	td {
		padding: 0.5rem 0.65rem;
		border-bottom: 1px solid var(--rule);
		color: var(--fg-soft);
		vertical-align: top;
	}
	td.mono { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }
	td.image { font-size: 0.78em; word-break: break-all; }
	td.bad { color: #fb7185; }
	td.msg { color: var(--fg); max-width: 540px; }

	.phase {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--bg);
	}
	.phase-running { color: #6ee7b7; }
	.phase-pending { color: #fcd34d; }
	.phase-succeeded { color: #93c5fd; }
	.phase-failed, .phase-unknown { color: #fb7185; }

	.state {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.72rem;
		background: var(--bg);
		color: var(--fg);
	}
	.state-running { color: #6ee7b7; }
	.state-waiting { color: #fcd34d; }
	.state-terminated { color: #fb7185; }

	.last-term {
		font-size: 0.72rem;
		color: var(--muted);
		margin-top: 0.2rem;
	}

	.cond {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		background: var(--bg);
	}
	.cond-true { color: #6ee7b7; }
	.cond-false { color: #fb7185; }
	.cond-unknown { color: #fcd34d; }

	.ev-type {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		background: var(--bg);
	}
	.ev-type-normal { color: #93c5fd; }
	.ev-type-warning { color: #fcd34d; }
	tr.warn td { background: rgba(252, 211, 77, 0.04); }

	.badge {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg-soft);
		font-size: 0.72rem;
		font-family: var(--font-mono);
	}

	.mount {
		font-size: 0.78rem;
	}
	.mount code {
		font-family: var(--font-mono);
		color: var(--fg);
	}
	.mount .ro {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0 0.3rem;
		background: var(--bg);
		color: var(--muted);
		font-size: 0.65rem;
		border-radius: 3px;
		text-transform: uppercase;
	}

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}

	.kv {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
		font-size: 0.84rem;
	}
	.kv dt {
		font-family: var(--font-mono);
		color: var(--muted);
		font-size: 0.82em;
	}
	.kv dd {
		margin: 0;
		font-family: var(--font-mono);
		color: var(--fg);
		word-break: break-all;
	}
	.kv dd.ann {
		font-size: 0.78em;
		color: var(--fg-soft);
	}

	.link {
		font: inherit;
		font-size: 0.8rem;
		font-weight: 400;
		background: none;
		border: 0;
		color: var(--accent);
		cursor: pointer;
		padding: 0 0 0 0.5rem;
		text-transform: none;
		letter-spacing: 0;
	}
	.link:hover { text-decoration: underline; }

	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		color: var(--fg);
	}
</style>
