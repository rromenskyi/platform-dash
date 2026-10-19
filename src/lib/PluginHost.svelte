<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { signIn } from '@auth/sveltekit/client';

	let { data }: { data: { plugin: { id: string; title: string; element: string }; ctx: Record<string, unknown> } } = $props();

	let host: HTMLDivElement | null = $state(null);
	let el: (HTMLElement & { context?: unknown }) | null = null;
	let loadError = $state<string | null>(null);
	let theme = $state<'light' | 'dark'>('dark');

	let route = $derived(`/plugins/${data.plugin.id}`);
	let path = $derived(page.url.pathname.slice(route.length));

	// Contract (README "Plugins"): a new object on every change, so a
	// plugin can react in its `context` setter.
	function context() {
		return {
			...data.ctx,
			theme,
			base: `/plugin-api/${data.plugin.id}`,
			route,
			path,
			// Navigate within the plugin through dash's router (keeps
			// back/forward working); path is relative to `route`.
			navigate: (to: string, opts?: { replace?: boolean }) =>
				goto(route + (to.startsWith('/') || to === '' ? to : `/${to}`), {
					replaceState: !!opts?.replace,
					keepFocus: true,
					noScroll: true
				}),
			// Session is gone or the back end rejected the token: sign in
			// again and come back here.
			reauth: () => {
				const p = page.data.authProvider as { id: string } | undefined;
				return signIn(p?.id ?? 'oidc', { callbackUrl: location.href });
			}
		};
	}

	$effect(() => {
		// Track everything context() reads, then push it to the element.
		void [theme, path, data.ctx];
		if (el) el.context = context();
	});

	function loadBundle(id: string, tag: string): Promise<void> {
		if (customElements.get(tag)) return Promise.resolve();
		const src = `/plugin-api/${id}/ui/plugin.js`;
		if (!document.querySelector(`script[data-plugin="${id}"]`)) {
			const s = document.createElement('script');
			s.type = 'module';
			s.src = src;
			s.dataset.plugin = id;
			s.onerror = () => {
				// Drop the failed tag so the next visit retries the load.
				s.remove();
				loadError = `Could not load ${src}`;
			};
			document.head.appendChild(s);
		}
		return customElements.whenDefined(tag).then(() => undefined);
	}

	onMount(() => {
		const read = () => (theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
		read();
		const mo = new MutationObserver(read);
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

		const { id, element } = data.plugin;
		let cancelled = false;
		const timeout = setTimeout(() => {
			if (!el && !loadError) loadError = `Plugin did not define <${element}> within 15s`;
		}, 15_000);
		loadBundle(id, element).then(() => {
			if (cancelled || !host) return;
			el = document.createElement(element);
			el.context = context();
			host.appendChild(el);
		});

		return () => {
			cancelled = true;
			clearTimeout(timeout);
			mo.disconnect();
			el?.remove();
			el = null;
		};
	});
</script>

{#if loadError}
	<p class="err">{loadError}</p>
{/if}
<div class="plugin-host" bind:this={host}></div>

<style>
	.plugin-host { min-height: 50vh; }
	.err { color: #fb7185; }
</style>
