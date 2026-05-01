<script lang="ts" module>
	// Recursive renderer for OpenAPI v3 schemas — what k8s CRDs ship as
	// `spec.versions[].schema.openAPIV3Schema`. Read-only docs surface;
	// no validation, no form-building.
	export type Schema = {
		type?: string;
		format?: string;
		description?: string;
		properties?: Record<string, Schema>;
		required?: string[];
		items?: Schema;
		additionalProperties?: Schema | boolean;
		enum?: unknown[];
		default?: unknown;
		nullable?: boolean;
		oneOf?: Schema[];
		anyOf?: Schema[];
		allOf?: Schema[];
		'x-kubernetes-preserve-unknown-fields'?: boolean;
	};
</script>

<script lang="ts">
	import Self from './SchemaTree.svelte';

	let { schema, name = '', required = false, depth = 0 }: {
		schema: Schema;
		name?: string;
		required?: boolean;
		depth?: number;
	} = $props();

	// `depth` is a stable prop per render — the warning about capturing
	// the initial value doesn't apply since we only ever want the depth
	// the parent passed in. Mirror into a derived to keep svelte-check
	// happy and to make the default-open rule reactive.
	const initiallyOpen = $derived(depth < 2);
	let openOverride = $state<boolean | null>(null);
	const open = $derived(openOverride ?? initiallyOpen);

	const typeStr = $derived.by(() => {
		const t = schema.type ?? '';
		if (t === 'array' && schema.items?.type) return `array<${schema.items.type}>`;
		if (schema.format) return `${t} (${schema.format})`;
		return t || (schema.properties ? 'object' : '?');
	});

	const propEntries = $derived(Object.entries(schema.properties ?? {}));
	const hasChildren = $derived(propEntries.length > 0 || (schema.type === 'array' && !!schema.items?.properties));
</script>

<div class="row" style="--depth: {depth}">
	{#if hasChildren}
		<button class="caret" onclick={() => (openOverride = !open)} aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
	{:else}
		<span class="caret-spacer"></span>
	{/if}

	{#if name}<span class="name" class:req={required}>{name}</span>{/if}
	<span class="type">{typeStr}</span>
	{#if schema.enum && schema.enum.length > 0}
		<span class="enum">enum: {schema.enum.map((v: unknown) => JSON.stringify(v)).join(' | ')}</span>
	{/if}
	{#if schema.default !== undefined}
		<span class="default">default: <code>{JSON.stringify(schema.default)}</code></span>
	{/if}
	{#if schema['x-kubernetes-preserve-unknown-fields']}
		<span class="tag">preserve-unknown</span>
	{/if}
</div>

{#if schema.description && (depth < 3 || open)}
	<p class="desc" style="--depth: {depth}">{schema.description}</p>
{/if}

{#if open && hasChildren}
	{@const reqSet = new Set(schema.required ?? [])}
	<div class="children">
		{#each propEntries as [k, v]}
			<Self schema={v} name={k} required={reqSet.has(k)} depth={depth + 1} />
		{/each}
		{#if schema.type === 'array' && schema.items?.properties}
			<Self schema={schema.items} name="[item]" depth={depth + 1} />
		{/if}
	</div>
{/if}

<style>
	.row {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.18rem 0;
		padding-left: calc(var(--depth, 0) * 1rem);
		font-size: 0.84rem;
	}
	.caret {
		font: inherit;
		font-size: 0.78rem;
		width: 0.95rem;
		padding: 0;
		background: none;
		border: 0;
		color: var(--muted);
		cursor: pointer;
	}
	.caret:hover { color: var(--fg); }
	.caret-spacer { display: inline-block; width: 0.95rem; }
	.name {
		font-family: var(--font-mono);
		color: var(--fg);
	}
	.name.req::after {
		content: '*';
		color: #fb7185;
		margin-left: 0.05rem;
	}
	.type {
		font-family: var(--font-mono);
		font-size: 0.78em;
		color: var(--accent);
	}
	.enum {
		font-family: var(--font-mono);
		font-size: 0.74em;
		color: var(--fg-soft);
	}
	.default {
		font-size: 0.76em;
		color: var(--muted);
	}
	.default code { font-family: var(--font-mono); color: var(--fg); }
	.tag {
		font-size: 0.7em;
		padding: 0 0.4rem;
		border-radius: 3px;
		background: var(--bg-elev);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.desc {
		margin: 0 0 0.2rem;
		padding-left: calc(var(--depth, 0) * 1rem + 1.4rem);
		font-size: 0.78rem;
		color: var(--muted);
		max-width: 80ch;
	}
</style>
