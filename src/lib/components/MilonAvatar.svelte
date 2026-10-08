<script lang="ts">
	/**
	 * Milon's face (assets/avatar/milon.svg), inline so it takes the accent
	 * color. `thinking` blinks the eyes while he works. Decorative: the text
	 * next to it, or the button's aria-label, says it is Milon.
	 */
	interface Props {
		size?: number;
		/** In a circle, as the sender in a chat. */
		framed?: boolean;
		thinking?: boolean;
		/** Cropped to the face, as an icon next to text (the drawing leaves wide margins for the circle). */
		tight?: boolean;
	}
	let { size = 28, framed = false, thinking = false, tight = false }: Props = $props();
</script>

<span class="avatar" class:framed style:--size="{size}px" aria-hidden="true">
	<svg viewBox={tight ? '17 19 62 62' : '0 0 96 96'} class:blink={thinking}>
		<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
			<path class="eye eye-l" d="M30 26V46" />
			<path class="eye eye-r" d="M66 26V46" />
			<path class="mouth" d="M34 62L48 74L62 62" />
		</g>
	</svg>
</span>

<style>
	.avatar {
		width: var(--size);
		height: var(--size);
		flex: none;
		display: inline-grid;
		place-items: center;
		color: var(--accent);
	}
	.framed {
		border-radius: 50%;
		background: var(--surface-2);
	}
	svg {
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.framed svg {
		width: 80%;
		height: 80%;
	}
	.eye {
		transform-box: fill-box;
		transform-origin: center;
	}
	.blink .eye {
		animation: blink 1.6s ease-in-out infinite;
	}
	@keyframes blink {
		0%,
		70%,
		100% {
			transform: scaleY(1);
		}
		80% {
			transform: scaleY(0.15);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.blink .eye {
			animation: none;
		}
	}
</style>
