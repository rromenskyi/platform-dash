<script lang="ts">
	import { page } from '$app/state';
	import { signIn } from '@auth/sveltekit/client';

	let session = $derived(page.data.session);
</script>

<h1>platform</h1>
<p>Operator dashboard for the k3s platform — tenants, services, infrastructure.</p>

{#if session?.user}
	<p>
		Signed in as <strong>{session.user.email ?? session.user.name}</strong>.
	</p>
	<p><a href="/profile">View profile</a> · <a href="/settings">Settings</a></p>
{:else}
	<p class="muted">Sign in with your Zitadel account to get started.</p>
	<button onclick={() => signIn('zitadel')}>Sign in</button>
{/if}
