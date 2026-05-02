<script lang="ts">
	import { age } from '$lib/k8s';
	import { invalidate, invalidateAll, goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { toast } from '$lib/toast.svelte';
	import { createKbdNav } from '$lib/kbd-nav.svelte';

	let { data } = $props();
	const canWrite = $derived(!!page.data.canWrite);

	// Flatten failing pods across clusters for kbd nav. j/k walks the
	// global list newest-cluster-first; Enter drills into the focused
	// pod's detail page; l opens its logs; x kills if admin.
	const flatPods = $derived(
		data.reports.flatMap((r) =>
			r.failingPods.map((p) => ({ cluster: r.cluster, namespace: p.namespace, name: p.name }))
		)
	);
	const kbd = createKbdNav({
		rowCount: () => flatPods.length,
		onEnter: (i) => {
			const p = flatPods[i];
			if (p) goto(`/k8s/${p.cluster}/pod/${p.namespace}/${p.name}`);
		}
	});
	$effect(() => kbd.attach());

	function onLogsKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target;
		if (
			t instanceof HTMLInputElement ||
			t instanceof HTMLTextAreaElement ||
			t instanceof HTMLSelectElement
		) return;
		const idx = kbd.focusedIdx;
		if (idx < 0 || idx >= flatPods.length) return;
		const p = flatPods[idx];
		if (e.key === 'l') {
			goto(`/k8s/${p.cluster}/pod/${p.namespace}/${p.name}/logs`);
			e.preventDefault();
		} else if (e.key === 'x' && canWrite) {
			killPod(p.cluster, p.namespace, p.name);
			e.preventDefault();
		}
	}
	$effect(() => {
		window.addEventListener('keydown', onLogsKey);
		return () => window.removeEventListener('keydown', onLogsKey);
	});

	// Per-row in-flight set so the operator's Nth click on the same
	// row doesn't fire N concurrent kicks. Keyed by `${cluster}|${ns}|${name}`.
	let busy = $state<Set<string>>(new Set());
	function isBusy(cluster: string, ns: string, name: string): boolean {
		return busy.has(`${cluster}|${ns}|${name}`);
	}
	function setBusy(k: string, on: boolean) {
		const next = new Set(busy);
		if (on) next.add(k);
		else next.delete(k);
		busy = next;
	}

	async function podAction(action: string, cluster: string, ns: string, name: string, body: object) {
		const key = `${cluster}|${ns}|${name}`;
		if (busy.has(key)) return;
		setBusy(key, true);
		try {
			const res = await fetch(`/k8s/${cluster}/api/${action}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const text = await res.text();
				toast.show(`${action} failed (${res.status}): ${text || res.statusText}`, 'err');
				return;
			}
			toast.show(`${action} ${ns}/${name} ok`);
			await invalidate(() => true);
		} catch (err) {
			toast.show(`${action} failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
		} finally {
			setBusy(key, false);
		}
	}

	function killPod(cluster: string, ns: string, name: string) {
		if (!confirm(`Delete pod ${ns}/${name}?\n\nController will respawn it if it has one.`)) return;
		podAction('pod-delete', cluster, ns, name, { namespace: ns, name });
	}

	const POLL_MS = 30_000;
	let timer: ReturnType<typeof setInterval> | null = null;
	let visible = $state(typeof document === 'undefined' ? true : !document.hidden);

	function refresh() {
		invalidateAll();
	}

	onMount(() => {
		timer = setInterval(() => {
			if (visible) invalidate(() => true);
		}, POLL_MS);
		const onVis = () => {
			visible = !document.hidden;
			if (visible) invalidate(() => true);
		};
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const allOk = $derived(
		data.totals.pods === 0 && data.totals.nodes === 0 && data.totals.events === 0
	);
</script>

<div class="header">
	<div>
		<h1>Incident</h1>
		<p class="muted small">
			Snapshot {age(data.snapshotAt)} ago across {data.reports.length} cluster{data.reports.length === 1 ? '' : 's'}.
			Auto-refresh 30s {visible ? '' : '(paused)'}
		</p>
	</div>
	<button class="ghost" onclick={refresh}>↻ Refresh</button>
</div>

{#if allOk && data.reports.every((r) => r.reachable)}
	<p class="ok">No failing pods, bad nodes, or recent warning events. Everything looks fine.</p>
{/if}

<section class="rollup">
	<div class="card chip"><span class="k">Failing pods</span><span class="v" class:bad={data.totals.pods > 0}>{data.totals.pods}</span></div>
	<div class="card chip"><span class="k">Bad nodes</span><span class="v" class:bad={data.totals.nodes > 0}>{data.totals.nodes}</span></div>
	<div class="card chip"><span class="k">Warning events</span><span class="v" class:warn={data.totals.events > 0}>{data.totals.events}</span></div>
</section>

{#each data.reports as r}
	<section class="cluster">
		<header class="cluster-head">
			<h2>{r.cluster}</h2>
			{#if !r.reachable}
				<span class="badge bad">unreachable</span>
			{:else}
				<span class="muted small">
					{r.totals.pods} pods · {r.totals.nodes} nodes · {r.totals.events} events
				</span>
			{/if}
		</header>

		{#if r.error}
			<p class="error">{r.error}</p>
		{/if}

		{#if r.badNodes.length > 0}
			<h3>Bad nodes</h3>
			<table>
				<thead><tr><th>Node</th><th>Condition</th><th>Status</th><th>Reason</th></tr></thead>
				<tbody>
					{#each r.badNodes as n}
						<tr>
							<td class="mono"><a href="/k8s/{r.cluster}/nodes">{n.name}</a></td>
							<td>{n.condition}</td>
							<td><span class="cond cond-{n.status.toLowerCase()}">{n.status}</span></td>
							<td>{n.reason ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if r.failingPods.length > 0}
			<h3>Failing pods <span class="muted small">(top {r.failingPods.length})</span></h3>
			<table>
				<thead>
					<tr><th>Namespace</th><th>Pod</th><th>Phase</th><th class="num">Restarts</th><th>Reason</th><th>Started</th><th class="actions-h">Actions</th></tr>
				</thead>
				<tbody>
					{#each r.failingPods as p}
						{@const flatIdx = flatPods.findIndex((x) => x.cluster === r.cluster && x.namespace === p.namespace && x.name === p.name)}
						<tr class:row-focused={flatIdx === kbd.focusedIdx}>
							<td>{p.namespace}</td>
							<td class="mono">
								<a href="/k8s/{r.cluster}/pod/{p.namespace}/{p.name}">{p.name}</a>
							</td>
							<td><span class="phase phase-{p.phase.toLowerCase()}">{p.phase}</span></td>
							<td class="num" class:bad={p.restarts > 0}>{p.restarts}</td>
							<td>
								{p.reason ?? '—'}
								{#if p.exitCode !== undefined}<span class="muted small">(exit {p.exitCode})</span>{/if}
							</td>
							<td>{age(p.startedAt)}</td>
							<td class="actions">
								<a class="chip-act" href="/k8s/{r.cluster}/pod/{p.namespace}/{p.name}/logs" title="Logs">logs</a>
								<a class="chip-act" href="/k8s/{r.cluster}/pod/{p.namespace}/{p.name}" title="Detail / events">detail</a>
								{#if canWrite}
									<button
										class="chip-act danger"
										onclick={() => killPod(r.cluster, p.namespace, p.name)}
										disabled={isBusy(r.cluster, p.namespace, p.name)}
										title="Delete pod (controller will respawn)"
									>kill</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if r.warningEvents.length > 0}
			<h3>Warning events <span class="muted small">(top {r.warningEvents.length})</span></h3>
			<table>
				<thead>
					<tr><th>Namespace</th><th>InvolvedObject</th><th>Reason</th><th>Message</th><th class="num">Count</th><th>Last seen</th></tr>
				</thead>
				<tbody>
					{#each r.warningEvents as e}
						<tr>
							<td>{e.namespace}</td>
							<td class="mono">{e.involved}</td>
							<td class="mono">{e.reason}</td>
							<td class="msg">{e.message}</td>
							<td class="num">{e.count}</td>
							<td>{age(e.lastSeen)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if r.reachable && r.failingPods.length === 0 && r.badNodes.length === 0 && r.warningEvents.length === 0}
			<p class="ok-mini">All quiet on this cluster.</p>
		{/if}
	</section>
{/each}

<style>
	.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
	.header h1 { margin: 0; }
	.header .small { margin-top: 0.25rem; }
	.muted { color: var(--muted); }
	.small { font-size: 0.85rem; }

	.ghost { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover { color: var(--fg); border-color: var(--muted); }

	.ok {
		margin-top: 1rem;
		padding: 0.7rem 1rem;
		border: 1px solid #6ee7b7;
		background: rgba(110, 231, 183, 0.08);
		color: #6ee7b7;
		border-radius: 8px;
	}
	.ok-mini {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
		font-style: italic;
	}

	.rollup {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
		margin: 1rem 0 1.25rem;
	}
	.card {
		padding: 0.85rem 1rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 10px;
	}
	.chip { display: flex; flex-direction: column; gap: 0.15rem; }
	.chip .k {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
	}
	.chip .v {
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-weight: 600;
		color: var(--fg);
	}
	.chip .v.bad { color: #fb7185; }
	.chip .v.warn { color: #fcd34d; }

	.cluster { margin-top: 1.5rem; padding: 1rem 1.1rem; border: 1px solid var(--rule); border-radius: 10px; background: var(--bg-elev); }
	.cluster-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
	.cluster-head h2 { margin: 0; font-family: var(--font-mono); font-size: 1.05rem; }
	.cluster h3 { margin: 1rem 0 0.4rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }

	.badge { font-size: 0.7rem; padding: 0.05rem 0.5rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
	.badge.bad { color: #fb7185; border: 1px solid #fb7185; }

	.error { padding: 0.6rem 0.85rem; background: rgba(251, 113, 133, 0.1); border: 1px solid #fb7185; border-radius: 6px; color: #fb7185; font-size: 0.85rem; }

	table { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin-top: 0.3rem; }
	th { text-align: left; padding: 0.4rem 0.6rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	td { padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); vertical-align: top; }
	tr:hover td { background: rgba(255, 255, 255, 0.02); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	td.mono a { color: var(--fg); }
	td.mono a:hover { color: var(--accent); }
	td.bad { color: #fb7185; font-weight: 500; }
	td.msg { color: var(--fg); max-width: 480px; }

	.phase { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 4px; font-size: 0.7rem; background: var(--bg); }
	.phase-failed, .phase-unknown { color: #fb7185; }
	.phase-pending { color: #fcd34d; }
	.phase-running { color: #6ee7b7; }
	.phase-succeeded { color: #93c5fd; }

	.cond { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 4px; font-size: 0.7rem; background: var(--bg); }
	.cond-true { color: #fcd34d; }
	.cond-false { color: #fb7185; }
	.cond-unknown { color: var(--muted); }

	td.actions { white-space: nowrap; }
	th.actions-h { text-align: right; }
	td.actions { text-align: right; }
	.chip-act {
		font: inherit;
		font-size: 0.72rem;
		padding: 0.1rem 0.45rem;
		margin-left: 0.25rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 4px;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
	}
	.chip-act:hover:not(:disabled) {
		color: var(--fg);
		border-color: var(--accent);
	}
	.chip-act.danger:hover:not(:disabled) { color: #fb7185; border-color: #fb7185; }
	.chip-act:disabled { cursor: wait; opacity: 0.5; }
	tr.row-focused td { box-shadow: inset 2px 0 0 var(--accent); }
</style>
