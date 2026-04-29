<script lang="ts">
	let { data } = $props();
</script>

<h1>Profile</h1>

<h2>User</h2>
<pre>{JSON.stringify(data.session?.user, null, 2)}</pre>

<h2>Tokens</h2>
<details>
	<summary>id_token</summary>
	<pre style="overflow-x:auto;">{data.session?.idToken ?? '(missing)'}</pre>
</details>
<details>
	<summary>access_token</summary>
	<pre style="overflow-x:auto;">{data.session?.accessToken ?? '(missing)'}</pre>
</details>
