<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { signIn, signOut } from '@auth/sveltekit/client';
	import { page } from '$app/state';

	let { children } = $props();
	let session = $derived(page.data.session);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>platform · dash</title>
</svelte:head>

<header class="topbar">
	<a class="brand" href="/">platform</a>
	<nav class="nav">
		<a href="/profile">Profile</a>
		<a href="/settings">Settings</a>
		{#if session?.user}
			<span class="muted">{session.user.email ?? session.user.name}</span>
			<button class="ghost" onclick={() => signOut()}>Sign out</button>
		{:else}
			<button onclick={() => signIn('zitadel')}>Sign in</button>
		{/if}
	</nav>
</header>

<main class="page">
	{@render children()}
</main>

<style>
	.topbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem var(--gutter);
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

	.nav {
		display: flex;
		gap: 1.25rem;
		align-items: center;
	}

	.nav a {
		color: var(--fg-soft);
		font-size: 0.95rem;
	}
	.nav a:hover { color: var(--fg); }

	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.page {
		max-width: var(--measure);
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 3rem) var(--gutter);
	}
</style>
