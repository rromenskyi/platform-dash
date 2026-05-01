<script lang="ts">
	let { data } = $props();

	const grouped = $derived(() => {
		const m = new Map<string, typeof data.cards>();
		for (const c of data.cards) {
			const k = c.cluster ?? '— cloud / external —';
			const arr = m.get(k);
			if (arr) arr.push(c);
			else m.set(k, [c]);
		}
		return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
	});
</script>

<h1>Databases</h1>
<p class="muted">{data.cards.length} target{data.cards.length === 1 ? '' : 's'} · grouped by cluster.</p>

{#if data.cards.length === 0}
	<p class="empty">
		No DB targets configured. Set <code>DASH_DB_TARGETS_JSON</code> in the dashboard
		environment to populate this page. See <code>src/lib/db-targets.server.ts</code> for the schema.
	</p>
{/if}

{#each grouped() as [group, cards]}
	<section class="grp">
		<h2>{group}</h2>
		<div class="grid">
			{#each cards as c}
				<a class="card" href="/db/{c.name}" class:bad={!c.hasUri}>
					<header>
						<h3>{c.label}</h3>
						<span class="kind kind-{c.kind}">{c.kind}</span>
					</header>
					<p class="host">{c.host}</p>
					{#if !c.hasUri}
						<p class="warn">URI env <code>{c.name}</code> not set</p>
					{/if}
				</a>
			{/each}
		</div>
	</section>
{/each}

<style>
	.muted { color: var(--muted); margin-bottom: 1rem; }
	.empty { padding: 1rem 1.2rem; border: 1px dashed var(--rule); border-radius: 8px; color: var(--muted); font-size: 0.9rem; }
	.empty code { font-family: var(--font-mono); color: var(--fg); }

	.grp + .grp { margin-top: 1.5rem; }
	.grp h2 {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
		margin: 0 0 0.6rem;
		font-family: var(--font-mono);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.85rem;
	}

	.card {
		display: block;
		padding: 0.85rem 1rem;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--bg-elev);
		color: var(--fg);
		transition: border-color var(--t-fast), transform var(--t-fast);
	}
	.card:hover { border-color: var(--accent); transform: translateY(-1px); }
	.card.bad { border-color: #fcd34d; }
	.card header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.3rem; }
	.card h3 { margin: 0; font-size: 1rem; font-family: var(--font-mono); }

	.kind {
		font-size: 0.7rem;
		padding: 0.05rem 0.55rem;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.kind-postgres { color: #93c5fd; border: 1px solid #93c5fd; }
	.kind-redis { color: #fb7185; border: 1px solid #fb7185; }

	.host {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--fg-soft);
	}
	.warn {
		margin: 0.3rem 0 0;
		color: #fcd34d;
		font-size: 0.78rem;
	}
	code { font-family: var(--font-mono); font-size: 0.85em; color: var(--fg); }
</style>
