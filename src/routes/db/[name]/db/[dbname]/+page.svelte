<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';

	let { data } = $props();

	const POLL_MS = 30_000;
	let timer: ReturnType<typeof setInterval> | null = null;
	let visible = $state(typeof document === 'undefined' ? true : !document.hidden);
	let q = $state('');
	let sortKey = $state<'name' | 'bytes' | 'rows' | 'kind'>('bytes');
	let sortDir = $state<'asc' | 'desc'>('desc');

	function refresh() {
		invalidate(`db:${data.target.name}:${data.dbName}`);
	}
	onMount(() => {
		timer = setInterval(() => {
			if (visible) refresh();
		}, POLL_MS);
		const onVis = () => {
			visible = !document.hidden;
			if (visible) refresh();
		};
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	function fmtBytes(b: number): string {
		const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
		let v = b;
		let i = 0;
		while (v >= 1024 && i < u.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${u[i]}`;
	}

	function setSort(k: typeof sortKey) {
		if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = k;
			sortDir = k === 'bytes' || k === 'rows' ? 'desc' : 'asc';
		}
	}
	function sortIcon(k: typeof sortKey) {
		if (sortKey !== k) return '';
		return sortDir === 'asc' ? ' ▲' : ' ▼';
	}

	type Row = { name: string; kind: string; bytes: number; rows: number; subtitle?: string };

	const rows = $derived.by((): Row[] => {
		if (!data.drill.ok) return [];
		if (data.drill.kind === 'postgres') {
			return data.drill.detail.relations.map((r) => ({
				name: r.name,
				kind: r.kind,
				bytes: r.bytes,
				rows: r.rows,
				subtitle: r.schema
			}));
		}
		return data.drill.detail.tables.map((t) => ({
			name: t.name,
			kind: 'table',
			bytes: t.bytes,
			rows: t.rowCount,
			subtitle: t.engine ?? undefined
		}));
	});

	const filtered = $derived(
		rows
			.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))
			.slice()
			.sort((a, b) => {
				let c = 0;
				if (sortKey === 'name') c = a.name.localeCompare(b.name);
				else if (sortKey === 'kind') c = a.kind.localeCompare(b.kind);
				else if (sortKey === 'bytes') c = a.bytes - b.bytes;
				else c = a.rows - b.rows;
				return sortDir === 'asc' ? c : -c;
			})
	);

	const totalBytes = $derived(
		data.drill.ok && data.drill.kind === 'postgres'
			? data.drill.detail.totalBytes
			: data.drill.ok && data.drill.kind === 'mysql'
				? data.drill.detail.totalBytes
				: 0
	);
</script>

<p class="crumb">
	<a href="/db">Databases</a> /
	<a href="/db/{data.target.name}">{data.target.label}</a> /
	<span>{data.dbName}</span>
</p>

<div class="header">
	<div>
		<h1>{data.dbName}</h1>
		<p class="muted small">
			<span class="kind kind-{data.target.kind}">{data.target.kind}</span>
			· <code>{data.target.host}</code>
			· total <code>{fmtBytes(totalBytes)}</code>
		</p>
	</div>
	<div class="head-actions">
		<span class="poll-state">{visible ? 'auto-refresh 30s' : 'paused'}</span>
		<button class="ghost" onclick={refresh}>↻ Refresh</button>
	</div>
</div>

{#if !data.drill.ok}
	<p class="error">DB unreachable: {data.drill.reason}</p>
{:else}
	{@const detail = data.drill.detail}
	{#if !detail.ok}
		<p class="error">{detail.error}</p>
	{:else}
		<div class="controls">
			<input class="search" type="search" bind:value={q} placeholder="Filter by table/object name…" />
		</div>
		<p class="muted small">{filtered.length} of {rows.length}</p>
		<table>
			<thead>
				<tr>
					<th class="sortable" onclick={() => setSort('name')}>Name{sortIcon('name')}</th>
					<th class="sortable" onclick={() => setSort('kind')}>Kind{sortIcon('kind')}</th>
					<th class="num sortable" onclick={() => setSort('bytes')}>Size{sortIcon('bytes')}</th>
					<th class="num sortable" onclick={() => setSort('rows')}>Rows{sortIcon('rows')}</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as r}
					<tr>
						<td class="mono">
							<div>{r.name}</div>
							{#if r.subtitle}<div class="sub">{r.subtitle}</div>{/if}
						</td>
						<td><span class="badge kind-{r.kind}">{r.kind}</span></td>
						<td class="num">{fmtBytes(r.bytes)}</td>
						<td class="num">{r.rows.toLocaleString()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/if}

<style>
	.crumb { font-size: 0.85rem; margin: 0 0 1rem; }
	.crumb a { color: var(--muted); }
	.crumb a:hover { color: var(--fg); }
	.crumb span { color: var(--fg); }

	.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
	.header h1 { margin: 0; }
	.header .small { margin-top: 0.25rem; }
	.head-actions { display: inline-flex; gap: 0.5rem; align-items: center; }
	.poll-state { font-size: 0.75rem; color: var(--muted); }

	.ghost { font: inherit; font-size: 0.85rem; padding: 0.4rem 0.8rem; border: 1px solid var(--rule); background: transparent; color: var(--fg-soft); border-radius: 6px; cursor: pointer; }
	.ghost:hover { color: var(--fg); border-color: var(--muted); }

	.kind { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
	.kind-postgres { color: #93c5fd; border: 1px solid #93c5fd; }
	.kind-mysql { color: #fcd34d; border: 1px solid #fcd34d; }

	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }
	.small { font-size: 0.85rem; }

	.controls { margin: 1rem 0 0.5rem; }
	.search { width: 100%; max-width: 320px; padding: 0.5rem 0.8rem; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 8px; color: var(--fg); font: inherit; }
	.search:focus { outline: none; border-color: var(--accent); }

	table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
	th { text-align: left; padding: 0.45rem 0.65rem; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
	th.num, td.num { text-align: right; }
	th.sortable { cursor: pointer; user-select: none; }
	th.sortable:hover { color: var(--fg); }
	td { padding: 0.5rem 0.65rem; border-bottom: 1px solid var(--rule); color: var(--fg-soft); }
	tr:hover td { background: var(--bg-elev); }
	td.mono { color: var(--fg); font-family: var(--font-mono); font-size: 0.85em; }
	.sub { font-size: 0.7em; color: var(--muted); margin-top: 0.1rem; }

	.badge {
		display: inline-block;
		padding: 0.05rem 0.45rem;
		border-radius: 3px;
		background: var(--bg-elev);
		color: var(--fg-soft);
		font-family: var(--font-mono);
		font-size: 0.7rem;
	}

	.error {
		padding: 0.75rem 1rem;
		background: rgba(251, 113, 133, 0.1);
		border: 1px solid #fb7185;
		border-radius: 8px;
		color: #fb7185;
	}
</style>
