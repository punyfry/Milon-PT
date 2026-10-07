<script lang="ts">
	/** Bottom sheet for choices and confirmations. Closes on Escape or a tap outside. */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		onclose: () => void;
		children: Snippet;
	}
	let { title, onclose, children }: Props = $props();
	let sheet: HTMLElement | undefined = $state();

	$effect(() => {
		const previous = document.activeElement as HTMLElement | null;
		sheet?.querySelector<HTMLElement>('button, input, textarea')?.focus();
		return () => previous?.focus?.();
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="sheet" role="dialog" aria-modal="true" aria-label={title} bind:this={sheet}>
		{@render children()}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		background: var(--scrim);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.sheet {
		width: 100%;
		max-width: 30rem;
		max-height: 88dvh;
		overflow-y: auto;
		background: var(--surface);
		border-radius: 24px 24px 0 0;
		padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
		display: grid;
		gap: 12px;
		animation: up 180ms ease-out;
	}
	@keyframes up {
		from {
			transform: translateY(24px);
			opacity: 0.4;
		}
	}
	.sheet :global(p) {
		margin: 0;
	}
	.sheet :global(h2) {
		font-size: 20px;
		font-weight: 600;
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: none;
		}
	}
</style>
