<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { SerializableNode } from './resource';
	import { savedViews } from './saved-views.svelte';

	let { tree = [] }: { tree?: SerializableNode[] } = $props();

	let open = $state(false);
	let q = $state('');
	let active = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);

	type Item = {
		label: string;
		group: string;
		href: string;
		hint?: string;
	};

	function flattenTree(nodes: SerializableNode[], crumbs: string[] = []): Item[] {
		const out: Item[] = [];
		for (const n of nodes) {
			const trail = [...crumbs, n.label];
			if (n.href) {
				out.push({
					label: n.label,
					group: trail.slice(0, -1).join(' / ') || 'Resources',
					href: n.href,
					hint: n.hint
				});
			}
			out.push(...flattenTree(n.children, trail));
		}
		return out;
	}

	const fixedItems: Item[] = [
		{ label: 'Incident', group: 'Pages', href: '/incident' },
		{ label: 'Databases', group: 'Pages', href: '/db' },
		{ label: 'Profile', group: 'Pages', href: '/profile' },
		{ label: 'Settings', group: 'Pages', href: '/settings' }
	];

	const items = $derived<Item[]>([
		...flattenTree(tree),
		...fixedItems,
		...savedViews.items.map((v) => ({
			label: v.name,
			group: 'Saved',
			href: `${v.path}${v.search}`
		}))
	]);

	// Tiny fuzzy: match all chars of q in order anywhere in (label+group).
	// Score = -sum(positions) so earlier matches rank higher.
	function score(item: Item, query: string): number | null {
		const hay = `${item.label} ${item.group}`.toLowerCase();
		const needle = query.toLowerCase();
		let pos = 0;
		let total = 0;
		for (const ch of needle) {
			const idx = hay.indexOf(ch, pos);
			if (idx === -1) return null;
			total += idx;
			pos = idx + 1;
		}
		return -total;
	}

	const results = $derived.by((): Item[] => {
		if (!q.trim()) return items.slice(0, 30);
		const scored = items
			.map((it) => ({ it, s: score(it, q.trim()) }))
			.filter((x): x is { it: Item; s: number } => x.s !== null)
			.sort((a, b) => b.s - a.s);
		return scored.slice(0, 30).map((x) => x.it);
	});

	function openModal() {
		open = true;
		q = '';
		active = 0;
		queueMicrotask(() => inputEl?.focus());
	}
	function closeModal() {
		open = false;
	}
	async function pick(href: string) {
		closeModal();
		await goto(href);
	}

	function onGlobalKey(e: KeyboardEvent) {
		// Cmd+K / Ctrl+K opens (or closes if already open) — bypasses
		// the typing-target check on purpose so users can pop the
		// palette from inside any input.
		if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
			e.preventDefault();
			open ? closeModal() : openModal();
			return;
		}
		if (open && e.key === 'Escape') {
			e.preventDefault();
			closeModal();
		}
	}

	function onListKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = Math.min(active + 1, results.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const r = results[active];
			if (r) pick(r.href);
		}
	}

	onMount(() => {
		document.addEventListener('keydown', onGlobalKey);
		return () => document.removeEventListener('keydown', onGlobalKey);
	});
</script>

{#if open}
	<div
		class="backdrop"
		role="button"
		tabindex="0"
		onclick={closeModal}
		onkeydown={(e) => e.key === 'Escape' && closeModal()}
	></div>
	<div class="modal" role="dialog" aria-label="Quick search">
		<input
			bind:this={inputEl}
			class="qinput"
			type="search"
			placeholder="Jump to… (cluster / page / saved view)"
			bind:value={q}
			onkeydown={onListKey}
			oninput={() => (active = 0)}
		/>
		<div class="results">
			{#each results as r, i (r.href)}
				<button
					class="row"
					class:active={i === active}
					onclick={() => pick(r.href)}
					onmouseenter={() => (active = i)}
				>
					<span class="row-label">{r.label}</span>
					<span class="row-group">{r.group}{r.hint ? ` · ${r.hint}` : ''}</span>
				</button>
			{:else}
				<p class="empty">No matches.</p>
			{/each}
		</div>
		<footer>
			<span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
			<span><kbd>Enter</kbd> open</span>
			<span><kbd>Esc</kbd> close</span>
		</footer>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 100;
		border: 0;
	}
	.modal {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		z-index: 101;
		width: min(640px, 92vw);
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 0;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
		overflow: hidden;
	}
	.qinput {
		width: 100%;
		padding: 0.95rem 1.1rem;
		font: inherit;
		font-size: 1rem;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--rule);
		color: var(--fg);
	}
	.qinput:focus { outline: none; }
	.results {
		max-height: 60vh;
		overflow: auto;
		padding: 0.3rem;
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.5rem 0.7rem;
		background: transparent;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		font: inherit;
	}
	.row:hover, .row.active { background: var(--bg); }
	.row-label {
		color: var(--fg);
		font-size: 0.92rem;
	}
	.row-group {
		color: var(--muted);
		font-size: 0.78rem;
		font-family: var(--font-mono);
	}
	.empty {
		padding: 0.85rem 0.7rem;
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
	}
	footer {
		display: flex;
		gap: 1rem;
		padding: 0.55rem 0.85rem;
		border-top: 1px solid var(--rule);
		font-size: 0.72rem;
		color: var(--muted);
	}
	kbd {
		font-family: var(--font-mono);
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 3px;
		padding: 0.02rem 0.35rem;
		font-size: 0.78em;
		color: var(--fg);
	}
</style>
