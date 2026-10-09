<script lang="ts">
	/**
	 * Text that is typed out a character at a time, with a pause after each
	 * sentence and paragraph. `instant` shows all of it (a tap to skip, or
	 * reduced motion). Screen readers get the whole text at once; the typing
	 * itself is hidden from them.
	 */
	import { untrack } from 'svelte';

	interface Props {
		text: string;
		instant?: boolean;
		/** Milliseconds per character. */
		speed?: number;
		ondone?: () => void;
	}
	let { text, instant = false, speed = 32, ondone }: Props = $props();

	let shown = $state(0);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const done = $derived(instant || shown >= text.length);

	/** Longer after a sentence and longest after a paragraph, so it reads like someone telling it. */
	function delayAfter(ch: string, next: string | undefined): number {
		if (ch === '\n') return speed * 12;
		if ('.!?…'.includes(ch) && next !== '.') return speed * 9;
		if (ch === ',' || ch === '–') return speed * 4;
		return speed;
	}

	function tick() {
		shown++;
		if (shown >= text.length) return ondone?.();
		timer = setTimeout(tick, delayAfter(text[shown - 1], text[shown]));
	}

	$effect(() => {
		// A new text starts over; `instant` shows the rest at once.
		void text;
		const skip = instant;
		clearTimeout(timer);
		untrack(() => {
			shown = skip ? text.length : 0;
			if (skip) ondone?.();
			else timer = setTimeout(tick, speed * 6);
		});
		return () => clearTimeout(timer);
	});

</script>

<span class="sr-only">{text}</span>
<span class="typed" aria-hidden="true"
	>{done ? text : text.slice(0, shown)}{#if !done}<span class="caret"></span>{/if}<span class="rest">{done ? '' : text.slice(shown)}</span></span
>

<style>
	.typed {
		white-space: pre-line;
	}
	/* The untyped rest keeps its place, so the text doesn't reflow while it is typed. */
	.rest {
		visibility: hidden;
	}
	.caret {
		display: inline-block;
		width: 2px;
		height: 1em;
		/* No net width, so the line doesn't wrap differently while the caret is in it. */
		margin: 0 -2px -0.15em 0;
		background: currentColor;
		animation: caret 1s steps(1) infinite;
	}
	@keyframes caret {
		50% {
			opacity: 0;
		}
	}
</style>
