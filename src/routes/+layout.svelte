<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--bg: #f6f6f4;
		--surface: #ffffff;
		--text: #1c1c1a;
		--muted: #6b6b66;
		--border: #e2e2dd;
		--accent: #2f6f4f;
		--on-accent: #ffffff;
		--danger: #b3261e;
		--done: #e3f1e8;
		/* Seriefärg för diagram, validerad mot ytan (dataviz-validatorn). */
		--series: #1f8a5b;
		--radius: 14px;
		color-scheme: light;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--bg: #141413;
			--surface: #1f1f1d;
			--text: #ecece8;
			--muted: #a0a09a;
			--border: #33332f;
			--accent: #5fb38a;
			--on-accent: #0d1f16;
			--danger: #f2827a;
			--done: #1f3328;
			--series: #3aa874;
			color-scheme: dark;
		}
	}
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		line-height: 1.4;
		-webkit-text-size-adjust: 100%;
	}
	:global(main) {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem 1rem 4rem;
	}
	:global(a) {
		color: var(--accent);
	}
	:global(button) {
		font: inherit;
	}
	:global(button.link) {
		background: none;
		border: none;
		padding: 0.25rem;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
	}
	:global(button.link.danger) {
		color: var(--danger);
	}
</style>
