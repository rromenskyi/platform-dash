<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { signIn, signOut } from '@auth/sveltekit/client';
	import { page } from '$app/state';

	let { children } = $props();
	let session = $derived(page.data.session);
	let pathname = $derived(page.url.pathname);

	// Sidebar nav. K8s explorer is the primary surface; profile +
	// settings live in the topbar so the sidebar stays focused on
	// "what's running".
	const nav: Array<{ section: string; items: Array<{ href: string; label: string }> }> = [
		{
			section: 'K8s',
			items: [
				{ href: '/k8s', label: 'Overview' },
				{ href: '/k8s/workloads', label: 'Workloads' },
				{ href: '/k8s/nodes', label: 'Nodes' },
				{ href: '/k8s/monitoring', label: 'Monitoring' }
			]
		}
	];

	function isActive(href: string): boolean {
		// Exact match for index pages, prefix-match for subpages.
		return pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>platform · dash</title>
</svelte:head>

<header class="topbar">
	<a class="brand" href="/">platform</a>
	<nav class="topnav">
		<a href="/profile" class:active={isActive('/profile')}>Profile</a>
		<a href="/settings" class:active={isActive('/settings')}>Settings</a>
		{#if session?.user}
			<span class="muted">{session.user.email ?? session.user.name}</span>
			<button class="ghost" onclick={() => signOut()}>Sign out</button>
		{:else}
			<button onclick={() => signIn('zitadel')}>Sign in</button>
		{/if}
	</nav>
</header>

<div class="layout">
	{#if session?.user}
		<aside class="sidebar">
			{#each nav as group}
				<div class="group">
					<h3>{group.section}</h3>
					<ul>
						{#each group.items as item}
							<li>
								<a href={item.href} class:active={isActive(item.href)}>{item.label}</a>
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
