<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { signIn, signOut } from '@auth/sveltekit/client';
	import { page } from '$app/state';

	let { children } = $props();
	let session = $derived(page.data.session);
	let pathname = $derived(page.url.pathname);
	let canRead = $derived(!!page.data.canRead);
	let canWrite = $derived(!!page.data.canWrite);
	let defaultCluster = $derived((page.data.defaultCluster as string | undefined) ?? 'local');
	// Single primary role label for the topbar — admin trumps sre when
	// a user holds both. Hidden if neither.
	let roleLabel = $derived(canWrite ? 'admin' : canRead ? 'sre' : '');

	// Detect the cluster the user is currently looking at by reading
	// the second path segment under /k8s/. When they're outside /k8s
	// (Profile/Settings), fall back to the configured default — that
	// way clicking "Workloads" from anywhere lands on a real page.
	let currentCluster = $derived.by(() => {
		const segs = pathname.split('/').filter(Boolean);
		if (segs[0] === 'k8s' && segs[1]) return segs[1];
		return defaultCluster;
	});

	// Sidebar nav. K8s explorer is the primary surface; profile +
	// settings live in the topbar so the sidebar stays focused on
	// "what's running". Admin section only renders for canWrite users.
	// `kind: 'k8s'` items are templated with the active cluster at
	// render time; admin items are absolute paths.
	type NavItem = { kind: 'k8s' | 'fixed'; href: string; label: string };
	type NavGroup = {
		section: string;
		items: NavItem[];
		adminOnly?: boolean;
	};
	const nav: NavGroup[] = [
		{
			section: 'K8s',
			items: [
				{ kind: 'k8s', href: '', label: 'Overview' },
				{ kind: 'k8s', href: '/workloads', label: 'Workloads' },
				{ kind: 'k8s', href: '/nodes', label: 'Nodes' },
				{ kind: 'k8s', href: '/crds', label: 'CRDs' },
				{ kind: 'k8s', href: '/monitoring', label: 'Monitoring' }
			]
		},
		{
			section: 'Admin',
			adminOnly: true,
			items: [{ kind: 'fixed', href: '/admin/metrics', label: 'k8s API metrics' }]
		}
	];

	const visibleNav = $derived(nav.filter((g) => !g.adminOnly || canWrite));

	// Carry the global namespace selection across /k8s/* nav clicks.
	// Without this, clicking "Workloads" while filtered to ns=foo would
	// drop the filter. Non-/k8s links (Profile/Settings/Admin) ignore it
	// because the selector lives only inside the /k8s layout.
	let currentNs = $derived(page.url.searchParams.get('ns') || '');

	function resolveHref(item: NavItem): string {
		if (item.kind === 'fixed') return item.href;
		const base = `/k8s/${currentCluster}${item.href}`;
		return currentNs ? `${base}?ns=${encodeURIComponent(currentNs)}` : base;
	}

	function isActive(item: NavItem): boolean {
		if (item.kind === 'fixed') {
			return pathname === item.href || pathname.startsWith(item.href + '/');
		}
		// k8s items: match by sub-path under /k8s/[cluster]/
		const expected = `/k8s/${currentCluster}${item.href}`;
		// Most-specific match wins so "Overview" doesn't light up alongside
		// "Workloads" when at /k8s/foo/workloads.
		const candidates = nav
			.flatMap((g) => g.items)
			.filter((i) => i.kind === 'k8s')
			.map((i) => `/k8s/${currentCluster}${i.href}`);
		const matches = candidates.filter(
			(h) => pathname === h || (h !== '/' && pathname.startsWith(h + '/'))
		);
		if (matches.length === 0) return false;
		const longest = matches.reduce((a, b) => (b.length > a.length ? b : a));
		return expected === longest;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>platform · dash</title>
</svelte:head>

<header class="topbar">
	<a class="brand" href="/">platform</a>
	<nav class="topnav">
		<a href="/profile" class:active={pathname === '/profile' || pathname.startsWith('/profile/')}>Profile</a>
		<a href="/settings" class:active={pathname === '/settings' || pathname.startsWith('/settings/')}>Settings</a>
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

<div class="layout">
	{#if session?.user && canRead}
		<aside class="sidebar">
			{#each visibleNav as group}
				<div class="group">
					<h3>{group.section}</h3>
					<ul>
						{#each group.items as item}
							<li>
								<a href={resolveHref(item)} class:active={isActive(item)}>{item.label}</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</aside>
	{/if}

	<main class="content">
		{@render children()}
	</main>
</div>

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
		padding: 1.25rem 1rem;
		background: var(--bg);
	}

	.group + .group { margin-top: 1.5rem; }

	.group h3 {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		font-weight: 600;
		margin: 0 0 0.5rem 0.5rem;
	}

	.group ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.group a {
		display: block;
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		color: var(--fg-soft);
		font-size: 0.92rem;
		transition: background var(--t-fast), color var(--t-fast);
	}
	.group a:hover {
		background: var(--bg-elev);
		color: var(--fg);
	}
	.group a.active {
		background: var(--bg-elev);
		color: var(--accent);
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
