<script lang="ts">
	// Render `text` with case-insensitive matches of `q` wrapped in
	// <mark>. Multiple disjoint matches; q is treated as a literal
	// substring (no regex). Empty q passes the text through unchanged.
	let { text, q }: { text: string; q: string } = $props();

	const segments = $derived.by(() => {
		if (!q) return [{ s: text, hl: false }];
		const needle = q.toLowerCase();
		const hay = text.toLowerCase();
		const out: Array<{ s: string; hl: boolean }> = [];
		let i = 0;
		while (i < text.length) {
			const found = hay.indexOf(needle, i);
			if (found < 0) {
				out.push({ s: text.slice(i), hl: false });
				break;
			}
			if (found > i) out.push({ s: text.slice(i, found), hl: false });
			out.push({ s: text.slice(found, found + needle.length), hl: true });
			i = found + needle.length;
		}
		return out;
	});
</script>

{#each segments as seg}{#if seg.hl}<mark>{seg.s}</mark>{:else}{seg.s}{/if}{/each}

<style>
	mark {
		background: rgba(252, 211, 77, 0.25);
		color: #fcd34d;
		padding: 0 2px;
		border-radius: 2px;
	}
</style>
