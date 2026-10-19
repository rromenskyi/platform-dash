<script lang="ts">
	import PluginHost from '$lib/PluginHost.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.plugin.title} · dash</title></svelte:head>

<!-- Re-mount when switching plugins: same route component otherwise. -->
{#key data.plugin.id}
	<PluginHost {data} />
{/key}
