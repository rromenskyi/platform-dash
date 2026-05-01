<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { signIn, signOut } from '@auth/sveltekit/client';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import type { SerializableNode } from '$lib/resource';
	import Toasts from '$lib/Toasts.svelte';
	import SavedViews from '$lib/SavedViews.svelte';
	import Shortcuts from '$lib/Shortcuts.svelte';
	import QuickSearch from '$lib/QuickSearch.svelte';
	import { closeAll as closeAllLive } from '$lib/live-registry.svelte';

	// Drop every active Live SSE before any client-side navigation.
	// Browsers cap concurrent HTTP/1.1 connections per origin at 6 and
	// SSE holds a slot indefinitely; in dev / non-HTTP/2 setups this
	// would deadlock SvelteKit's load fetch behind the open stream.
	// Pages that re-mount their stream via $effect re-open it after the
	// navigation completes.
	beforeNavigate(() => {
		closeAllLive();
	});

	let { children } = $props();
	let session = $derived(page.data.session);
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
	<a class="brand" href="/">platform</a>
	<nav class="topnav">
		{#if session?.user && canRead}
			{#if page.data.apiHealth}
				{@const h = page.data.apiHealth as { count: number; errors: number; p95: number }}
				<a
					class="apipill"
					class:bad={h.errors > 0}
					href={canWrite ? '/admin/metrics' : undefined}
					title="k8s API: {h.count} samples, {h.errors} errors, p95 {h.p95}ms"
				>
					<span class="dot"></span>
					API {h.p95}ms{#if h.errors > 0} · {h.errors}✕{/if}
				</a>
			{/if}
			<a href="/incident" class="incident" class:active={pathname === '/incident'} title="Snapshot of failing pods, bad nodes, warnings">⚠ Incident</a>
		{/if}
		<a href="/profile" class:active={pathname === '/profile' || pathname.startsWith('/profile/')}>Profile</a>
		<a href="/settings" class:active={pathname === '/settings' || pathname.startsWith('/settings/')}>Settings</a>
		{#if session?.user && canRead}
			<SavedViews />
		{/if}
		{#if session?.user}
			{#if roleLabel}
				<span class="role role-{roleLabel}">{roleLabel}</span>
			{:else}
				<span class="role role-none" title="Sign-in succeeded but no platform_admin or platform_sre role assigned">no role</span>
			{/if}
			<span class="muted">{session.user.email ?? session.user.name}</span>
			<button class="ghost" onclick={() => signOut()}>Sign out</button>
		{:else}
			<button onclick={() => signIn('zitadel')}>Sign in</button>
		{/if}
	</nav>
</header>

{#snippet treeNode(n: SerializableNode, depth: number)}
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
	{#if session?.user && canRead}
		<aside class="sidebar">
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
					<h3>Admin</h3>
					<ul class="tree">
						<li class="tnode">
							<div class="trow">
								<span class="caret-spacer"></span>
								<a class="tlink" class:active={isHrefActive('/admin/metrics')} href="/admin/metrics">k8s API metrics</a>
							</div>
						</li>
					</ul>
				</div>
			{/if}
		</aside>
	{/if}

	<main class="content">
		{@render children()}
	</main>
</div>

<Toasts />

{#if session?.user && canRead}
	<Shortcuts {defaultCluster} />
	<QuickSearch {tree} />
{/if}

<style>
	.topbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
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

	.topnav {
		display: flex;
		gap: 1.25rem;
		align-items: center;
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

	.content {
		padding: clamp(1.5rem, 3vw, 2.5rem) var(--gutter);
		max-width: 90rem;
		min-width: 0;
	}

	@media (max-width: 720px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.sidebar {
			border-right: 0;
			border-bottom: 1px solid var(--rule);
		}
	}
</style>
