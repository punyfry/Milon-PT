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
	<MilonAvatar framed {thinking} />
	<div class="bubble" class:thinking>{@render children()}</div>
</div>

<style>
	.from-milon {
		align-self: flex-start;
		justify-self: start;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		max-width: 92%;
		min-width: 0;
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
