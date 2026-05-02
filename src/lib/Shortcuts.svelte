<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let { defaultCluster = 'local' }: { defaultCluster?: string } = $props();

	let helpOpen = $state(false);
	let pendingPrefix = $state<string | null>(null);
	let prefixTimer: ReturnType<typeof setTimeout> | null = null;

	function clearPrefix() {
		pendingPrefix = null;
		if (prefixTimer) {
			clearTimeout(prefixTimer);
			prefixTimer = null;
		}
	}
	function setPrefix(p: string) {
		pendingPrefix = p;
		if (prefixTimer) clearTimeout(prefixTimer);
		prefixTimer = setTimeout(() => clearPrefix(), 1500);
	}

	function currentCluster(): string {
		const segs = page.url.pathname.split('/').filter(Boolean);
		return segs[0] === 'k8s' && segs[1] ? segs[1] : defaultCluster;
	}

	function focusSearch() {
		// Pick the first visible search input on the page — Workloads has
		// q, list pages have q, db pages have q, etc.
		const el = document.querySelector<HTMLInputElement>('input[type="search"]');
		if (el) {
			el.focus();
			el.select();
		}
	}

	function isTypingTarget(el: EventTarget | null): boolean {
		if (!(el instanceof HTMLElement)) return false;
		if (el.isContentEditable) return true;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
	}

	function onKey(e: KeyboardEvent) {
		// Esc always closes help and clears prefix.
		if (e.key === 'Escape') {
			helpOpen = false;
			clearPrefix();
			return;
		}
		// Ignore when user is typing in a field (so 'g' inside search
		// doesn't navigate). Allow `?` even from inputs since it's
		// shifted and unlikely to clash.
		if (isTypingTarget(e.target) && e.key !== '?') return;
		// Ignore modified keys (Ctrl/Meta/Alt) — those belong to the
		// browser / OS.
		if (e.ctrlKey || e.metaKey || e.altKey) return;

		const c = currentCluster();

		if (pendingPrefix === 'g') {
			// Two-key sequences from `g`. Only accept letters; anything
			// else cancels the prefix.
			clearPrefix();
			switch (e.key.toLowerCase()) {
				case 'o': goto(`/k8s/${c}`); e.preventDefault(); return;
				case 'w': goto(`/k8s/${c}/workloads`); e.preventDefault(); return;
				case 'n': goto(`/k8s/${c}/nodes`); e.preventDefault(); return;
				case 's': goto(`/k8s/${c}/services`); e.preventDefault(); return;
				case 'i': goto(`/incident`); e.preventDefault(); return;
				case 'd': goto(`/db`); e.preventDefault(); return;
				case 'c': goto(`/k8s/${c}/crds`); e.preventDefault(); return;
				case 'e': goto(`/k8s/${c}/events`); e.preventDefault(); return;
				case 'a': goto(`/admin/audit`); e.preventDefault(); return;
				case 'm': goto(`/k8s/${c}/monitoring`); e.preventDefault(); return;
				case 'p': goto(`/profile`); e.preventDefault(); return;
				case 'g': goto(`/`); e.preventDefault(); return;
			}
			return;
		}

		switch (e.key) {
			case 'g':
				setPrefix('g');
				e.preventDefault();
				return;
			case '/':
				focusSearch();
				e.preventDefault();
				return;
			case 'r':
				invalidateAll();
				e.preventDefault();
				return;
			case '?':
				helpOpen = !helpOpen;
				e.preventDefault();
				return;
		}
	}

	onMount(() => {
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});
</script>

{#if pendingPrefix}
	<div class="prefix-hint">
		<kbd>{pendingPrefix}</kbd> waiting for next key…
	</div>
{/if}

{#if helpOpen}
	<div
		class="help-backdrop"
		role="button"
		tabindex="0"
		onclick={() => (helpOpen = false)}
		onkeydown={(e) => e.key === 'Escape' && (helpOpen = false)}
	></div>
	<div class="help" role="dialog" aria-label="Keyboard shortcuts">
		<header>
			<h2>Keyboard shortcuts</h2>
			<button class="x" onclick={() => (helpOpen = false)} aria-label="Close">×</button>
		</header>

		<section>
			<h3>Navigation (sequences)</h3>
			<dl>
				<dt><kbd>g</kbd> <kbd>g</kbd></dt><dd>home (/)</dd>
				<dt><kbd>g</kbd> <kbd>o</kbd></dt><dd>k8s overview</dd>
				<dt><kbd>g</kbd> <kbd>w</kbd></dt><dd>workloads</dd>
				<dt><kbd>g</kbd> <kbd>n</kbd></dt><dd>nodes</dd>
				<dt><kbd>g</kbd> <kbd>s</kbd></dt><dd>services</dd>
				<dt><kbd>g</kbd> <kbd>c</kbd></dt><dd>crds</dd>
				<dt><kbd>g</kbd> <kbd>e</kbd></dt><dd>events (cluster-wide)</dd>
				<dt><kbd>g</kbd> <kbd>m</kbd></dt><dd>monitoring</dd>
				<dt><kbd>g</kbd> <kbd>i</kbd></dt><dd>incident</dd>
				<dt><kbd>g</kbd> <kbd>d</kbd></dt><dd>databases</dd>
				<dt><kbd>g</kbd> <kbd>a</kbd></dt><dd>audit log</dd>
				<dt><kbd>g</kbd> <kbd>p</kbd></dt><dd>profile</dd>
			</dl>
		</section>

		<section>
			<h3>List pages</h3>
			<dl>
				<dt><kbd>j</kbd> / <kbd>k</kbd></dt><dd>focus next / previous row</dd>
				<dt><kbd>↵</kbd></dt><dd>open the focused row's detail page</dd>
				<dt><kbd>x</kbd></dt><dd>toggle bulk selection (workloads / incident, admin only)</dd>
				<dt><kbd>l</kbd></dt><dd>open logs (incident only)</dd>
			</dl>
		</section>

		<section>
			<h3>Actions</h3>
			<dl>
				<dt><kbd>/</kbd></dt><dd>focus search box on the current page</dd>
				<dt><kbd>r</kbd></dt><dd>refresh page data (invalidateAll)</dd>
				<dt><kbd>?</kbd></dt><dd>toggle this cheatsheet</dd>
				<dt><kbd>Esc</kbd></dt><dd>close help / cancel prefix / clear bulk selection</dd>
				<dt><kbd>⌘</kbd> <kbd>K</kbd> / <kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>quick-search palette</dd>
			</dl>
		</section>

		<p class="muted small">
			Shortcuts ignore <kbd>Ctrl</kbd> / <kbd>⌘</kbd> / <kbd>Alt</kbd> combos and pause inside text inputs (so typing <kbd>g</kbd> in a search box behaves normally).
		</p>
	</div>
{/if}

<style>
	.prefix-hint {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		font-size: 0.78rem;
		padding: 0.4rem 0.7rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 6px;
		color: var(--fg-soft);
		z-index: 90;
	}
	kbd {
		font-family: var(--font-mono);
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 4px;
		padding: 0.05rem 0.4rem;
		font-size: 0.78em;
		color: var(--fg);
	}

	.help-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 100;
		border: 0;
	}
	.help {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 101;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		min-width: 460px;
		max-width: 560px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
	}
	.help header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	.help h2 { margin: 0; font-size: 1.1rem; }
	.help h3 {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
		margin: 1rem 0 0.4rem;
	}
	.help section:first-of-type h3 { margin-top: 0; }
	.help dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
		font-size: 0.88rem;
	}
	.help dt {
		display: flex;
		gap: 0.2rem;
		align-items: center;
	}
	.help dd {
		margin: 0;
		color: var(--fg-soft);
	}
	.help .x {
		font: inherit;
		font-size: 1.4rem;
		line-height: 1;
		padding: 0 0.5rem;
		background: transparent;
		border: 0;
		color: var(--muted);
		cursor: pointer;
	}
	.help .x:hover { color: var(--fg); }
	.help .small { font-size: 0.78rem; margin-top: 1rem; color: var(--muted); }
</style>
