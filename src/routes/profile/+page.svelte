<script lang="ts">
	let { data } = $props();
</script>

<h1>Profile</h1>

<h2>User</h2>
<pre>{JSON.stringify(data.session?.user, null, 2)}</pre>

<h2>Tokens</h2>
<details>
	<summary>id_token</summary>
	<pre>{data.session?.idToken ?? '(missing)'}</pre>
</details>
<details>
	<summary>access_token</summary>
	<pre>{data.session?.accessToken ?? '(missing)'}</pre>
</details>

<style>
	details { margin: 0.6rem 0; }
	summary {
		cursor: pointer;
		color: var(--fg-soft);
		padding: 0.4rem 0;
	}
	summary:hover { color: var(--fg); }
	pre { white-space: pre-wrap; word-break: break-all; }
</style>
