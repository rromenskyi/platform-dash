<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { signIn, signOut } from '@auth/sveltekit/client';
	import { page } from '$app/state';

	let { children } = $props();
	let session = $derived(page.data.session);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header
	style="display:flex; justify-content:space-between; align-items:center; padding:1rem 1.5rem; border-bottom:1px solid #eee;"
>
	<a href="/" style="font-weight:600; text-decoration:none; color:inherit;">platform</a>
	<nav style="display:flex; gap:1rem; align-items:center;">
		<a href="/profile">Profile</a>
		{#if session?.user}
			<span style="opacity:0.7;">{session.user.email ?? session.user.name}</span>
			<button onclick={() => signOut()}>Sign out</button>
		{:else}
			<button onclick={() => signIn('zitadel')}>Sign in</button>
		{/if}
	</nav>
</header>

<main style="padding:1.5rem;">
	{@render children()}
</main>
