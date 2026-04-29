<script lang="ts">
	import { page } from '$app/state';
	import { signIn } from '@auth/sveltekit/client';

	let session = $derived(page.data.session);
</script>

{#if session?.user}
	<h1>platform</h1>
	<p>Operator dashboard for the k3s platform.</p>
	<p><a href="/k8s">Open K8s overview →</a></p>
{:else}
	<h1>platform</h1>
	<p class="muted">Operator dashboard for the k3s platform.</p>
	<p>Sign in with your Zitadel account to get started.</p>
	<button onclick={() => signIn('zitadel')}>Sign in</button>
{/if}
