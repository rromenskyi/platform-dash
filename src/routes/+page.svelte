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
	<section class="gate">
		<div class="panel">
			<h1 class="mark">platform</h1>
			<p class="lede">Operator console for the k3s platform.</p>
			<button class="signin" onclick={() => signIn('zitadel')}>Sign in with Zitadel</button>
			<p class="note">Access follows your platform role in Zitadel.</p>
		</div>
	</section>
{/if}

<style>
	/* Centred in the viewport below the topbar; text stays left-aligned
	   inside a narrow column so it reads as one block, not a banner. */
	.gate {
		display: grid;
		place-items: center;
		min-height: calc(100dvh - 10rem);
	}

	.panel {
		width: min(100%, 26rem);
		padding-left: 1.25rem;
		border-left: 2px solid var(--accent);
	}

	.mark {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(3rem, 9vw, 4.75rem);
		font-weight: 600;
		letter-spacing: -0.045em;
		line-height: 0.95;
	}

	.lede {
		margin: 0.9rem 0 1.75rem;
		color: var(--fg-soft);
		font-size: 1.05rem;
		line-height: 1.5;
	}

	.signin {
		padding: 0.65rem 1.4rem;
		font-weight: 500;
	}

	.signin:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.note {
		margin: 1rem 0 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
