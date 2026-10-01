<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { signOut } from '@auth/sveltekit/client';
	import { page, updated } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import type { SerializableNode } from '$lib/resource';
	import Toasts from '$lib/Toasts.svelte';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import SavedViews from '$lib/SavedViews.svelte';
	import Shortcuts from '$lib/Shortcuts.svelte';
	import QuickSearch from '$lib/QuickSearch.svelte';
	import { closeAll as closeAllLive } from '$lib/live-registry.svelte';

	// Drop every active Live SSE before any client-side navigation, and
	// force a hard reload if a redeploy was detected (kit.version
	// pollInterval). Browsers cap concurrent HTTP/1.1 connections per
	// origin at 6 and SSE holds a slot indefinitely; in dev / non-HTTP/2
	// setups this would deadlock SvelteKit's load fetch behind the open
	// stream. Stale-build reloads close the gap between an old client
	// runtime and freshly-deployed server data — without this, hashed
	// chunk URLs from the prior build 404 and any drift in the loader's
	// data shape blows up at hydration ("Unexpected token 'export'" /
	// "Cannot read properties of undefined").
	beforeNavigate((nav) => {
		closeAllLive();
		if (updated.current && nav.to?.url) {
			nav.cancel();
			location.href = nav.to.url.href;
		}
	});

	let { children } = $props();
	let session = $derived(page.data.session);

	// Theme: persisted in localStorage. Inline script in app.html sets
	// data-theme on <html> before first paint to avoid a dark→light
	// flash. Here we mirror that into a $state for the toggle button.
	const THEME_KEY = 'platform-dash:theme';
	let theme = $state<'dark' | 'light'>('dark');
	$effect(() => {
		if (typeof document === 'undefined') return;
		const cur = document.documentElement.dataset.theme;
		theme = cur === 'light' ? 'light' : 'dark';
	});
	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		if (typeof document === 'undefined') return;
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			/* */
		}
	}

	// Mobile sidebar drawer. Hidden by default on narrow viewports
	// (CSS @media handles the visual); toggled by a hamburger in the
	// topbar. Closes on any nav so the operator doesn't have to dismiss
	// it manually.
	let mobileSidebar = $state(false);
	$effect(() => {
		// Close drawer on pathname change.
		void pathname;
		mobileSidebar = false;
	});
	function onSidebarKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && mobileSidebar) {
			e.preventDefault();
			mobileSidebar = false;
		}
	}
	$effect(() => {
		if (!mobileSidebar) return;
		window.addEventListener('keydown', onSidebarKey);
		return () => window.removeEventListener('keydown', onSidebarKey);
	});
	let pathname = $derived(page.url.pathname);
	let canRead = $derived(!!page.data.canRead);
	let canWrite = $derived(!!page.data.canWrite);
	let defaultCluster = $derived((page.data.defaultCluster as string | undefined) ?? 'local');
	let tree = $derived((page.data.tree as SerializableNode[] | undefined) ?? []);
	let roleLabel = $derived(canWrite ? 'admin' : canRead ? 'sre' : '');

	// Detect the cluster the user is currently looking at by reading
	// the second path segment under /k8s/. When they're outside /k8s
	// (Profile/Settings), fall back to the configured default — the
	// tree auto-expands the cluster the user is in (or the default).
	let currentCluster = $derived.by(() => {
		const segs = pathname.split('/').filter(Boolean);
		if (segs[0] === 'k8s' && segs[1]) return segs[1];
		return defaultCluster;
	});

	// Carry the global namespace selection across /k8s/* nav clicks.
	let currentNs = $derived(page.url.searchParams.get('ns') || '');

	function withNs(href: string | undefined): string | undefined {
		if (!href) return href;
		if (!currentNs || !href.startsWith('/k8s/')) return href;
		return `${href}?ns=${encodeURIComponent(currentNs)}`;
	}

	function isHrefActive(href: string | undefined): boolean {
		if (!href) return false;
		// Most-specific match: don't light up parents when a deeper child
		// is active (overview vs workloads under same cluster).
		if (pathname === href) return true;
		// Tree groups (cluster root) match when we're anywhere inside.
		if (pathname.startsWith(href + '/')) return true;
		return false;
	}

	function isHrefSelfActive(href: string | undefined, allHrefs: string[]): boolean {
		if (!href) return false;
		const matches = allHrefs.filter((h) => pathname === h || pathname.startsWith(h + '/'));
		if (matches.length === 0) return false;
		const longest = matches.reduce((a, b) => (b.length > a.length ? b : a));
		return href === longest;
	}

	// Per-node open state, persisted via Map. Cluster groups default-
	// open when current; other clusters default-closed. Manual toggles
	// override defaults thereafter (sticky for the session).
	let openOverrides = $state<Map<string, boolean>>(new Map());
	function isOpen(n: SerializableNode): boolean {
		const override = openOverrides.get(n.id);
		if (override !== undefined) return override;
		// Default rule: a node is open if the current pathname falls
		// inside any of its descendants' hrefs.
		return nodeContainsActive(n);
	}
	function nodeContainsActive(n: SerializableNode): boolean {
		if (n.href && (pathname === n.href || pathname.startsWith(n.href + '/'))) return true;
		for (const c of n.children) if (nodeContainsActive(c)) return true;
		return false;
	}
	function toggle(n: SerializableNode) {
		const cur = isOpen(n);
		openOverrides.set(n.id, !cur);
		openOverrides = new Map(openOverrides);
	}

	// Flat list of every leaf-ish href in the tree — used for the
	// "longest match wins" active-highlight calculation so leaf nodes
	// don't all light up at the same depth.
	function collectLeafHrefs(nodes: SerializableNode[]): string[] {
		const out: string[] = [];
		for (const n of nodes) {
			if (n.href) out.push(n.href);
			out.push(...collectLeafHrefs(n.children));
		}
		return out;
	}
	const allHrefs = $derived(collectLeafHrefs(tree));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>platform · dash</title>
</svelte:head>

<header class="topbar">
	{#if session?.user && canRead}
		<button
			class="hamburger"
			onclick={() => (mobileSidebar = !mobileSidebar)}
			aria-label={mobileSidebar ? 'Close menu' : 'Open menu'}
			title="Toggle sidebar"
		>{mobileSidebar ? '×' : '☰'}</button>
	{/if}
	<a class="brand" href="/">platform</a>
	{#if page.data.build}
		{@const b = page.data.build as { sha: string; short: string; time: string; url: string }}
		<a
			class="build"
			href={b.url}
			target="_blank"
			rel="noopener"
			title={`Build ${b.sha} — ${b.time}`}
		>{b.short}</a>
	{/if}
	<nav class="topnav">
		{#if session?.user && canRead}
			{#if page.data.apiHealth}
				{@const h = page.data.apiHealth as { count: number; errors: number; p95: number }}
				<a
					class="apipill"
					class:bad={h.errors > 0}
					class:idle={h.count === 0}
					href={canWrite ? '/admin/metrics' : undefined}
					title={h.count === 0
						? 'k8s API: no samples in the last 5 min — open a /k8s page to seed the ring'
						: `k8s API (last 5 min): ${h.count} samples, ${h.errors} errors, p95 ${h.p95}ms`}
				>
					<span class="dot"></span>
					{#if h.count === 0}
						API —
					{:else}
						API {h.p95}ms{#if h.errors > 0} · {h.errors}✕{/if}
					{/if}
				</a>
			{/if}
			{#if page.data.stuck}
				{@const s = page.data.stuck as { totalFailing: number; totalBadNodes: number; perCluster: Array<{ cluster: string; failing: number; badNodes: number }> }}
				{@const total = s.totalFailing + s.totalBadNodes}
				<a
					href="/incident"
					class="incident"
					class:active={pathname === '/incident'}
					class:bad={total > 0}
					title={total === 0
						? 'No failing pods or bad nodes'
						: `Live count from k8s — drops when pods recover (≤30s cache).\n\n${s.perCluster.map((c) => `${c.cluster}: ${c.failing} failing · ${c.badNodes} bad nodes`).join('\n')}`}
				>
					⚠ Incident{#if total > 0} · {total}{/if}
				</a>
			{:else}
				<a href="/incident" class="incident" class:active={pathname === '/incident'} title="Snapshot of failing pods, bad nodes, warnings">⚠ Incident</a>
			{/if}
		{/if}
		<button
			class="theme-toggle"
			onclick={toggleTheme}
			title="Toggle light / dark theme"
			aria-label="Toggle theme"
		>{theme === 'dark' ? '☾' : '☀'}</button>
		{#if session?.user}
			<a class="acct" href="/profile" class:active={pathname === '/profile' || pathname.startsWith('/profile/')}>Profile</a>
			<a class="acct" href="/settings" class:active={pathname === '/settings' || pathname.startsWith('/settings/')}>Settings</a>
		{/if}
		{#if session?.user && canRead}
			<span class="saved"><SavedViews /></span>
		{/if}
		{#if session?.user}
			{#if roleLabel}
				<span class="role role-{roleLabel}" title={session.user.email ?? session.user.name ?? ''}>{roleLabel}</span>
			{:else}
				<span class="role role-none" title="Sign-in succeeded but no platform_admin or platform_sre role assigned">no role</span>
			{/if}
			<span class="muted who">{session.user.email ?? session.user.name}</span>
			<button class="ghost" onclick={() => signOut()}>Sign out</button>
		{/if}
	</nav>
</header>

{#snippet treeNode(n: SerializableNode, depth: number)}
	{@const meta = (n.meta ?? {}) as { family?: string; kind?: string }}
	{@const isClusterRoot = meta.family === 'k8s' && meta.kind === 'Cluster'}
	{@const stuckRow = isClusterRoot && page.data.stuck
		? (page.data.stuck as { perCluster: Array<{ cluster: string; failing: number; badNodes: number; reachable: boolean }> }).perCluster.find((c) => c.cluster === n.label)
		: null}
	{@const stuckTotal = stuckRow ? stuckRow.failing + stuckRow.badNodes : 0}
	<li class="tnode" style="--depth: {depth}">
		<div class="trow">
			{#if n.children.length > 0}
				<button class="caret" onclick={() => toggle(n)} aria-label={isOpen(n) ? 'Collapse' : 'Expand'}>
					{isOpen(n) ? '▾' : '▸'}
				</button>
			{:else}
				<span class="caret-spacer"></span>
			{/if}
			{#if n.href}
				<a class="tlink" class:active={isHrefSelfActive(n.href, allHrefs)} href={withNs(n.href)}>
					{n.label}
					{#if n.hint}<span class="hint">{n.hint}</span>{/if}
					{#if isClusterRoot && stuckRow && !stuckRow.reachable}
						<span class="health unreachable" title="Cluster unreachable">●</span>
					{:else if isClusterRoot && stuckTotal > 0}
						<span class="health bad" title="{stuckRow!.failing} failing pod{stuckRow!.failing === 1 ? '' : 's'}, {stuckRow!.badNodes} bad node{stuckRow!.badNodes === 1 ? '' : 's'}">{stuckTotal}</span>
					{:else if isClusterRoot && stuckRow}
						<span class="health ok" title="Cluster healthy"></span>
					{/if}
				</a>
			{:else}
				<button class="tlink as-button" onclick={() => toggle(n)}>
					{n.label}
					{#if n.hint}<span class="hint">{n.hint}</span>{/if}
				</button>
			{/if}
		</div>
		{#if n.children.length > 0 && isOpen(n)}
			<ul class="tchildren">
				{#each n.children as c}
					{@render treeNode(c, depth + 1)}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div class="layout">
	{#if session?.user && canRead && mobileSidebar}
		<button
			class="sidebar-backdrop"
			aria-label="Close sidebar"
			onclick={() => (mobileSidebar = false)}
		></button>
	{/if}
	{#if session?.user && canRead}
		<aside class="sidebar" class:mobile-open={mobileSidebar}>
			{#if tree.length > 0}
				<div class="group">
					<h3>Resources</h3>
					<ul class="tree">
						{#each tree as n}
							{@render treeNode(n, 0)}
						{/each}
					</ul>
				</div>
			{/if}
			{#if canWrite}
				<div class="group">
					<h3>Tools</h3>
					<ul class="tree">
						<li class="tnode">
							<div class="trow">
								<span class="caret-spacer"></span>
								<a class="tlink" class:active={isHrefActive('/tools/http')} href="/tools/http">HTTP tester</a>
							</div>
						</li>
						<li class="tnode">
							<div class="trow">
								<span class="caret-spacer"></span>
								<a class="tlink" class:active={isHrefActive('/tools/shell')} href="/tools/shell">Cloud shell</a>
							</div>
						</li>
					</ul>
				</div>
				<div class="group">
					<h3>Admin</h3>
					<ul class="tree">
						<li class="tnode">
							<div class="trow">
								<span class="caret-spacer"></span>
								<a class="tlink" class:active={isHrefActive('/admin/metrics')} href="/admin/metrics">k8s API metrics</a>
							</div>
						</li>
						<li class="tnode">
							<div class="trow">
								<span class="caret-spacer"></span>
								<a class="tlink" class:active={isHrefActive('/admin/audit')} href="/admin/audit">Audit log</a>
							</div>
						</li>
					</ul>
				</div>
			{/if}
			<!-- Topbar drops Profile/Settings on narrow screens; reachable here. -->
			<div class="group mobile-only">
				<h3>Account</h3>
				<ul class="tree">
					<li class="tnode">
						<div class="trow">
							<span class="caret-spacer"></span>
							<a class="tlink" class:active={isHrefActive('/profile')} href="/profile">Profile</a>
						</div>
					</li>
					<li class="tnode">
						<div class="trow">
							<span class="caret-spacer"></span>
							<a class="tlink" class:active={isHrefActive('/settings')} href="/settings">Settings</a>
						</div>
					</li>
				</ul>
			</div>
		</aside>
	{/if}

	<main class="content">
		{@render children()}
	</main>
</div>

<Toasts />
<ConfirmDialog />

{#if session?.user && canRead}
	<Shortcuts {defaultCluster} />
	<QuickSearch {tree} />
{/if}

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.85rem var(--gutter);
		border-bottom: 1px solid var(--rule);
		background: var(--bg);
	}
	.brand {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 1.05rem;
		color: var(--fg);
		letter-spacing: -0.01em;
	}
	.brand:hover { color: var(--accent-d); }

	.build {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--muted);
		padding: 0.1rem 0.4rem;
		border: 1px solid var(--rule);
		border-radius: 4px;
		text-decoration: none;
	}
	.build:hover { color: var(--fg); border-color: var(--muted); }

	.topnav {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-left: auto;
		min-width: 0;
		white-space: nowrap;
	}
	.topnav a {
		color: var(--fg-soft);
		font-size: 0.95rem;
	}
	.topnav a:hover { color: var(--fg); }
	.topnav a.active { color: var(--accent); }
	.topnav a.incident {
		font-size: 0.85rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid #fcd34d;
		border-radius: 4px;
		color: #fcd34d;
	}
	.topnav a.incident:hover { background: rgba(252, 211, 77, 0.08); }
	.topnav a.incident.active { background: rgba(252, 211, 77, 0.15); }
	.topnav a.incident.bad {
		border-color: #fb7185;
		color: #fb7185;
		background: rgba(251, 113, 133, 0.08);
	}
	.topnav a.incident.bad:hover { background: rgba(251, 113, 133, 0.15); }

	.topnav .apipill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		padding: 0.18rem 0.55rem;
		border: 1px solid var(--rule);
		border-radius: 4px;
		color: var(--fg-soft);
		font-family: var(--font-mono);
	}
	.topnav .apipill .dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #6ee7b7;
		box-shadow: 0 0 4px #6ee7b7;
	}
	.topnav .apipill.bad { border-color: #fb7185; color: #fb7185; }
	.topnav .apipill.idle { color: var(--muted); }
	.topnav .apipill.idle .dot { background: var(--muted); box-shadow: none; }

	.topnav .theme-toggle {
		font: inherit;
		font-size: 1rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--rule);
		background: transparent;
		color: var(--fg-soft);
		border-radius: 4px;
		cursor: pointer;
		line-height: 1;
	}
	.topnav .theme-toggle:hover { color: var(--fg); border-color: var(--muted); opacity: 1; }
	.topnav .apipill.bad .dot { background: #fb7185; box-shadow: 0 0 4px #fb7185; }
	.topnav .apipill:hover { color: var(--fg); border-color: var(--muted); }

	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.role {
		display: inline-block;
		padding: 0.1rem 0.55rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border: 1px solid var(--rule);
		background: var(--bg-elev);
	}
	.role-admin { color: #6ee7b7; border-color: #6ee7b7; }
	.role-sre { color: #a5b4fc; border-color: #a5b4fc; }
	.role-none { color: #fb7185; border-color: #fb7185; }

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 240px) 1fr;
		min-height: calc(100vh - 64px);
	}
	.layout:has(.sidebar:empty),
	.layout:not(:has(.sidebar)) {
		grid-template-columns: 1fr;
	}

	.sidebar {
		border-right: 1px solid var(--rule);
		padding: 1.25rem 0.5rem;
		background: var(--bg);
	}

	.group + .group { margin-top: 1.25rem; }
	.group h3 {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		font-weight: 600;
		margin: 0 0 0.4rem 0.75rem;
	}

	.tree {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.tnode { list-style: none; }
	.tchildren {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.trow {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		padding-left: calc(var(--depth, 0) * 0.85rem);
	}

	.caret {
		font: inherit;
		font-size: 0.85rem;
		width: 1.1rem;
		padding: 0;
		background: none;
		border: 0;
		color: var(--muted);
		cursor: pointer;
		text-align: center;
	}
	.caret:hover { color: var(--fg); }
	.caret-spacer { display: inline-block; width: 1.1rem; }

	.tlink {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: space-between;
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		color: var(--fg-soft);
		font-size: 0.88rem;
		transition: background var(--t-fast), color var(--t-fast);
	}
	.tlink:hover { background: var(--bg-elev); color: var(--fg); }
	.tlink.active { background: var(--bg-elev); color: var(--accent); }
	.tlink.as-button {
		font: inherit;
		text-align: left;
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	.hint {
		font-size: 0.7rem;
		color: var(--muted);
		font-family: var(--font-mono);
		margin-left: 0.4rem;
	}

	.health {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		padding: 0 0.35rem;
		border-radius: 8px;
		line-height: 1;
	}
	.health.ok {
		width: 6px;
		height: 6px;
		padding: 0;
		background: #6ee7b7;
		box-shadow: 0 0 4px #6ee7b7;
	}
	.health.bad {
		background: #fb7185;
		color: #1c1917;
		font-weight: 600;
		min-width: 1.2rem;
		text-align: center;
	}
	.health.unreachable {
		color: #fb7185;
		font-size: 0.85rem;
	}

	.content {
		padding: clamp(1.5rem, 3vw, 2.5rem) var(--gutter);
		max-width: 90rem;
		min-width: 0;
	}

	.hamburger {
		display: none;
		font: inherit;
		font-size: 1.25rem;
		line-height: 1;
		padding: 0.2rem 0.55rem;
		background: transparent;
		border: 1px solid var(--rule);
		color: var(--fg-soft);
		border-radius: 6px;
		cursor: pointer;
		margin-right: 0.5rem;
	}
	.hamburger:hover { color: var(--fg); border-color: var(--muted); }

	.sidebar-backdrop {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 90;
		border: 0;
		padding: 0;
		cursor: default;
	}

	.mobile-only { display: none; }

	@media (max-width: 1100px) {
		.topnav .who { display: none; }
	}

	@media (max-width: 720px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.mobile-only { display: block; }
		.topnav { gap: 0.6rem; }
		.build,
		.topnav .apipill,
		.topnav .acct,
		.topnav .saved,
		.topnav .role { display: none; }
		.hamburger { display: inline-block; }
		.sidebar {
			position: fixed;
			top: 64px;
			left: 0;
			bottom: 0;
			width: min(280px, 80vw);
			z-index: 91;
			transform: translateX(-100%);
			transition: transform var(--t-med) ease;
			overflow-y: auto;
			border-right: 1px solid var(--rule);
			border-bottom: 0;
			background: var(--bg);
		}
		.sidebar.mobile-open {
			transform: translateX(0);
			box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
		}
		.sidebar-backdrop { display: block; }
	}
</style>
