<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { confirm as confirmDialog } from '$lib/confirm.svelte';
	import { toast } from '$lib/toast.svelte';
	import KubectlMenu from '$lib/KubectlMenu.svelte';
	import { page } from '$app/state';

	let { data } = $props();
	let canWrite = $derived(!!page.data.canWrite);

	// Subset of summary fields are kind-specific (Deployment has no
	// currentReplicas, DaemonSet uses desiredReplicas, etc). Read with
	// optional chaining throughout the template — the template doesn't
	// branch on kind for those, just renders whatever the loader filled.
	const s = $derived(data.summary);

	function fmtAge(iso: string | undefined): string {
		if (!iso) return '—';
		const ms = Date.now() - Date.parse(iso);
		if (!Number.isFinite(ms) || ms < 0) return '—';
		const sec = Math.floor(ms / 1000);
		if (sec < 60) return `${sec}s`;
		const m = Math.floor(sec / 60);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 48) return `${h}h`;
		return `${Math.floor(h / 24)}d`;
	}

	async function onRestart() {
		if (!canWrite) return;
		if (s.kind === 'DaemonSet') {
			toast.show('rollout restart for DaemonSet is not wired yet', 'warn');
			return;
		}
		const proceed = await confirmDialog({
			title: `Restart ${s.kind}?`,
			body: `${s.namespace}/${s.name}\n\nRolls a new revision; pods are recreated one by one.`,
			confirm: 'Restart'
		});
		if (!proceed) return;
		const res = await fetch(`/k8s/${data.cluster}/api/restart`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: s.kind, namespace: s.namespace, name: s.name })
		});
		if (res.ok) {
			toast.show('restart triggered');
			await invalidateAll();
		} else {
			const t = await res.text();
			toast.show(`restart failed: ${t}`, 'err');
		}
	}

	async function onScale() {
		if (!canWrite) return;
		if (s.kind === 'DaemonSet') {
			toast.show('DaemonSet replicas are derived from node count — scale not supported', 'warn');
			return;
		}
		const cur = String(s.replicas ?? 0);
		const next = prompt(`Scale ${s.kind} ${s.namespace}/${s.name} to N replicas:`, cur);
		if (next == null) return;
		const n = Number(next);
		if (!Number.isInteger(n) || n < 0) {
			toast.show('replicas must be a non-negative integer', 'err');
			return;
		}
		const res = await fetch(`/k8s/${data.cluster}/api/scale`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: s.kind, namespace: s.namespace, name: s.name, replicas: n })
		});
		if (res.ok) {
			toast.show(`scaled to ${n}`);
			await invalidateAll();
		} else {
			const t = await res.text();
			toast.show(`scale failed: ${t}`, 'err');
		}
	}

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

<p class="crumb">
	<a href="/k8s/{data.cluster}/workloads">← Workloads</a>
</p>

<div class="header">
	<h1>
		<span class="kind kind-{s.kind.toLowerCase()}">{s.kind}</span>
		<span class="name">{s.namespace}/{s.name}</span>
		<span class="cluster-tag">{data.cluster}</span>
	</h1>
	<div class="actions">
		{#if canWrite}
			<KubectlMenu target={{ cluster: data.cluster, kind: s.kind, namespace: s.namespace, name: s.name }} />
			{#if s.kind !== 'DaemonSet'}
				<button class="act" onclick={onRestart}>restart</button>
				<button class="act" onclick={onScale}>scale</button>
			{/if}
		{/if}
		<button class="ghost" onclick={refresh} disabled={refreshing}>
			<span class:spin={refreshing}>↻</span> Refresh
		</button>
	</div>
</div>

<section class="cards">
	<div class="card">
		<h3>Replicas</h3>
		<div class="grid">
			<div class="stat">
				<span class="lbl">{s.kind === 'DaemonSet' ? 'desired' : 'spec'}</span>
				<span class="val">{s.kind === 'DaemonSet' ? (s.desiredReplicas ?? 0) : (s.replicas ?? 0)}</span>
			</div>
			<div class="stat">
				<span class="lbl">ready</span>
				<span class="val" class:bad={(s.readyReplicas ?? 0) < (s.kind === 'DaemonSet' ? (s.desiredReplicas ?? 0) : (s.replicas ?? 0))}>{s.readyReplicas ?? 0}</span>
			</div>
			<div class="stat">
				<span class="lbl">available</span>
				<span class="val">{s.availableReplicas ?? 0}</span>
			</div>
			<div class="stat">
				<span class="lbl">updated</span>
				<span class="val">{s.updatedReplicas ?? 0}</span>
			</div>
			{#if s.currentReplicas != null}
				<div class="stat">
					<span class="lbl">current</span>
					<span class="val">{s.currentReplicas}</span>
				</div>
			{/if}
		</div>
	</div>

	<div class="card">
		<h3>Status</h3>
		<dl class="kv">
			<dt>strategy</dt><dd>{s.strategy ?? '—'}</dd>
			<dt>generation</dt>
			<dd>
				{s.generation ?? '—'}
				{#if s.observedGeneration != null && s.generation != null && s.observedGeneration !== s.generation}
					<span class="warn-pill" title="Controller hasn't observed the latest spec yet">·obs {s.observedGeneration}</span>
				{/if}
			</dd>
			<dt>created</dt><dd>{s.creationTimestamp ?? '—'}{#if s.creationTimestamp} <span class="muted">({fmtAge(s.creationTimestamp)})</span>{/if}</dd>
			<dt>service account</dt><dd class="mono">{s.serviceAccountName ?? 'default'}</dd>
		</dl>
	</div>

	<div class="card">
		<h3>Selector</h3>
		{#if Object.keys(s.selector).length === 0}
			<p class="muted small">none</p>
		{:else}
			<ul class="kv-list">
				{#each Object.entries(s.selector) as [k, v]}
					<li><code>{k}</code>=<code>{v}</code></li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="card">
		<h3>Images</h3>
		{#if s.images.length === 0}
			<p class="muted small">—</p>
		{:else}
			<ul class="kv-list">
				{#each s.images as img}
					<li class="mono">{img}</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<section>
	<h2>Pods <span class="muted small">({data.pods.length})</span></h2>
	{#if data.podsError}
		<p class="err small">list pods failed: {data.podsError}</p>
	{:else if data.pods.length === 0}
		<p class="muted small">No pods match this controller's selector. The controller may have created none yet, or pods are stuck before scheduling.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th>Phase</th>
					<th class="num">Ready</th>
					<th class="num">Restarts</th>
					<th>Node</th>
					<th>Age</th>
				</tr>
			</thead>
			<tbody>
				{#each data.pods as p}
					<tr>
						<td>
							<a href="/k8s/{data.cluster}/pod/{s.namespace}/{p.name}">{p.name}</a>
							{#if p.notReady.length > 0}<span class="muted"> · not ready: {p.notReady.join(', ')}</span>{/if}
						</td>
						<td><span class="phase phase-{p.phase.toLowerCase()}">{p.phase}</span></td>
						<td class="num">{p.ready}</td>
						<td class="num" class:bad={p.restarts > 0}>{p.restarts || ''}</td>
						<td>
							{#if p.node}
								<a href="/k8s/{data.cluster}/nodes#{p.node}">{p.node}</a>
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td>{fmtAge(p.creationTimestamp)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section>
	<h2>Events <span class="muted small">(controller scope)</span></h2>
	{#if data.eventsError}
		<p class="err small">list events failed: {data.eventsError}</p>
	{:else if data.events.length === 0}
		<p class="muted small">No events. Pod-level events live on the individual pod pages.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Last seen</th>
					<th>Type</th>
					<th>Reason</th>
					<th>Message</th>
					<th class="num">Count</th>
				</tr>
			</thead>
			<tbody>
				{#each data.events as e}
					<tr>
						<td class="mono small">{e.lastSeen ?? '—'}</td>
						<td><span class="ev-type ev-type-{e.type.toLowerCase()}">{e.type}</span></td>
						<td class="mono">{e.reason}</td>
						<td>{e.message}</td>
						<td class="num">{e.count}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

{#if data.scopedAudit.length > 0}
	<section>
		<h2>Recent actions</h2>
		<table>
			<thead>
				<tr>
					<th>Time</th>
					<th>User</th>
					<th>Action</th>
					<th>Outcome</th>
					<th>Message</th>
				</tr>
			</thead>
			<tbody>
				{#each data.scopedAudit as a}
					<tr>
						<td class="mono small">{a.ts}</td>
						<td class="mono">{a.user}</td>
						<td class="mono">{a.action}</td>
						<td><span class="outcome outcome-{a.outcome}">{a.outcome}</span></td>
						<td>{a.message ?? ''}</td>
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
	.header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
	.header h1 { display: inline-flex; align-items: baseline; gap: 0.6rem; margin: 0; flex-wrap: wrap; }
	.kind { font-size: 0.7em; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 4px; background: var(--bg-elev); border: 1px solid var(--rule); letter-spacing: 0.07em; }
	.kind-deployment { color: #93c5fd; }
	.kind-statefulset { color: #c4b5fd; }
	.kind-daemonset { color: #fcd34d; }
	.name { font-family: var(--font-display); }
	.cluster-tag { font-family: var(--font-mono); font-size: 0.55em; color: var(--accent); }
	.actions { display: inline-flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; }
	.act {
		font: inherit; font-size: 0.82rem; padding: 0.35rem 0.75rem;
		background: var(--bg); border: 1px solid var(--rule); color: var(--fg-soft);
		border-radius: 6px; cursor: pointer;
	}
	.act:hover { color: var(--fg); border-color: var(--muted); }
	.ghost {
		font: inherit; font-size: 0.82rem; padding: 0.35rem 0.75rem;
		border: 1px solid var(--rule); background: transparent; color: var(--fg-soft);
		border-radius: 6px; cursor: pointer;
	}
	.ghost:hover:not(:disabled) { color: var(--fg); border-color: var(--muted); }
	.ghost:disabled { opacity: 0.5; cursor: not-allowed; }
	.spin { display: inline-block; animation: spin 0.7s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin: 1rem 0 2rem; }
	.card { padding: 0.85rem 1rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 10px; }
	.card h3 { margin: 0 0 0.55rem; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }

	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 0.5rem; }
	.stat { display: flex; flex-direction: column; gap: 0.05rem; padding: 0.4rem 0.5rem; background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; }
	.stat .lbl { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
	.stat .val { font-family: var(--font-display); font-size: 1.05rem; font-weight: 600; color: var(--fg); }
	.stat .val.bad { color: #fb7185; }

	.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.7rem; margin: 0; font-size: 0.86rem; }
	.kv dt { color: var(--muted); }
	.kv dd { margin: 0; color: var(--fg); }
	.kv-list { list-style: none; margin: 0; padding: 0; font-size: 0.85rem; }
	.kv-list li { padding: 0.15rem 0; }

	.warn-pill {
		display: inline-block; padding: 0 0.4rem; border-radius: 999px;
		font-size: 0.7em; background: rgba(252,211,77,0.15); color: #fcd34d;
		margin-left: 0.4rem;
	}

	h2 { font-size: 1rem; margin: 1.5rem 0 0.6rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
	th { text-align: left; padding: 0.4rem 0.6rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.bad { color: #fb7185; }
	td a { color: var(--accent); }
	td a:hover { color: var(--fg); }
	.small { font-size: 0.8rem; }
	.err { color: #fb7185; }

	.phase {
		display: inline-block; padding: 0 0.45rem; border-radius: 4px;
		font-size: 0.78em; background: var(--bg-elev); border: 1px solid var(--rule);
	}
	.phase-running { color: #86efac; border-color: rgba(134,239,172,0.3); }
	.phase-pending { color: #fcd34d; border-color: rgba(252,211,77,0.3); }
	.phase-failed, .phase-unknown { color: #fb7185; border-color: rgba(251,113,133,0.3); }
	.phase-succeeded { color: #93c5fd; border-color: rgba(147,197,253,0.3); }

	.ev-type {
		display: inline-block; padding: 0 0.4rem; border-radius: 4px;
		font-size: 0.78em; background: var(--bg-elev); border: 1px solid var(--rule);
	}
	.ev-type-warning { color: #fb7185; border-color: rgba(251,113,133,0.3); }
	.ev-type-normal { color: #86efac; border-color: rgba(134,239,172,0.3); }

	.outcome {
		display: inline-block; padding: 0 0.4rem; border-radius: 4px;
		font-size: 0.78em; background: var(--bg-elev); border: 1px solid var(--rule);
	}
	.outcome-ok { color: #86efac; }
	.outcome-error { color: #fb7185; }

	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }
	.mono { font-family: var(--font-mono); }
	.muted { color: var(--muted); }
</style>
