<script lang="ts">
	/** Shows a chat reply with simple markdown (see $lib/markdown). No HTML from the text. */
	import { parseMarkdown, type Line } from '$lib/markdown';

	let { text }: { text: string } = $props();
	const blocks = $derived(parseMarkdown(text));
</script>

{#snippet line(spans: Line)}
	{#each spans as s, i (i)}
		{#if s.code}<code>{s.text}</code>
		{:else if s.bold && s.italic}<strong><em>{s.text}</em></strong>
		{:else if s.bold}<strong>{s.text}</strong>
		{:else if s.italic}<em>{s.text}</em>
		{:else}{s.text}{/if}
	{/each}
{/snippet}

<div class="md">
	{#each blocks as b, i (i)}
		{#if b.type === 'heading'}
			<p class="heading">{@render line(b.line)}</p>
		{:else if b.type === 'p'}
			<p>
				{#each b.lines as l, j (j)}{#if j}<br />{/if}{@render line(l)}{/each}
			</p>
		{:else if b.type === 'ul'}
			<ul>
				{#each b.items as item, j (j)}<li>{@render line(item)}</li>{/each}
			</ul>
		{:else}
			<ol start={b.start}>
				{#each b.items as item, j (j)}<li>{@render line(item)}</li>{/each}
			</ol>
		{/if}
	{/each}
</div>

<style>
	.md {
		white-space: normal;
	}
	.md > :first-child {
		margin-top: 0;
	}
	.md > :last-child {
		margin-bottom: 0;
	}
	p,
	ul,
	ol {
		margin: 0.5em 0;
	}
	ul,
	ol {
		padding-left: 1.3em;
	}
	li + li {
		margin-top: 0.15em;
	}
	.heading {
		font-weight: 600;
	}
	code {
		font-size: 0.9em;
		padding: 0.05em 0.3em;
		border-radius: 4px;
		background: var(--line);
	}
</style>
