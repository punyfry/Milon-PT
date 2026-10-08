<script lang="ts">
	/** A message from Milon in a chat: his avatar as the sender, then the bubble. */
	import type { Snippet } from 'svelte';
	import MilonAvatar from './MilonAvatar.svelte';

	interface Props {
		/** Milon is working on a reply: the eyes blink and the text is muted. */
		thinking?: boolean;
		children: Snippet;
	}
	let { thinking = false, children }: Props = $props();
</script>

<div class="from-milon">
	<span class="sender"><MilonAvatar framed {thinking} /></span>
	<div class="bubble" class:thinking>{@render children()}</div>
</div>

<style>
	.from-milon {
		/* Both: the builder's log is a flex column, the helper's a grid. */
		align-self: flex-start;
		justify-self: start;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		max-width: 92%;
		min-width: 0;
	}
	/* Centred on the bubble's first line of text. */
	.sender {
		display: flex;
		margin-top: 7px;
	}
	.bubble {
		min-width: 0;
		padding: 10px 14px;
		border-radius: 14px;
		border: 1px solid var(--line);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.thinking {
		color: var(--muted);
		font-style: italic;
	}
</style>
