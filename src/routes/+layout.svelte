<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import NavProgress from '$lib/components/NavProgress.svelte';
	import PendingSaves from '$lib/components/PendingSaves.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	/** The main menu shows everywhere except during a workout and on sign-in. */
	const showTabs = $derived(!page.url.pathname.startsWith('/pass/') && page.url.pathname !== '/login' && !page.error);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<NavProgress />
<div class="app" class:tabs={showTabs}>
	<PendingSaves />
	{@render children()}
</div>
{#if showTabs}<TabBar />{/if}

<style>
	/* Tokens per DESIGN.md. Dark is the base; light is mint on a warm grey-beige. */
	:global(:root) {
		--bg: #f3f2ee;
		--surface: #fafaf8;
		--surface-2: #e2dfd7;
		--step: #cfcbc1;
		--seg: #d6d3ca;
		--text: #18181a;
		--heading: #3c3c40;
		--muted: #605f59;
		--soft: #4a4946;
		--dim: #6e6d66;
		--line: rgba(0, 0, 0, 0.09);
		--ring: rgba(0, 0, 0, 0.28);
		--accent: #0d6b63;
		--on-accent: #ffffff;
		--danger: #a3362b;
		--scrim: rgba(20, 20, 18, 0.35);
		/* Charts follow the accent. */
		--series: var(--accent);
		--font: 'Bricolage Grotesque', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		--mono: 'DM Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		--radius: 14px;
		--tabbar-h: calc(61px + env(safe-area-inset-bottom, 0px));
		color-scheme: light;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) {
			--bg: #0a0a0b;
			--surface: #17171a;
			--surface-2: #26262a;
			--step: #37373c;
			--seg: #26262a;
			--text: #f2f2f0;
			--heading: #c8c8cd;
			--muted: #8e8e94;
			--soft: #bdbdc2;
			--dim: #818188;
			--line: rgba(255, 255, 255, 0.08);
			--ring: rgba(255, 255, 255, 0.22);
			--accent: #5eead4;
			--on-accent: #0a0f0c;
			--danger: #f2a49b;
			--scrim: rgba(0, 0, 0, 0.6);
			color-scheme: dark;
		}
	}
	:global(:root[data-theme='dark']) {
		--bg: #0a0a0b;
		--surface: #17171a;
		--surface-2: #26262a;
		--step: #37373c;
		--seg: #26262a;
		--text: #f2f2f0;
		--heading: #c8c8cd;
		--muted: #8e8e94;
		--soft: #bdbdc2;
		--dim: #818188;
		--line: rgba(255, 255, 255, 0.08);
		--ring: rgba(255, 255, 255, 0.22);
		--accent: #5eead4;
		--on-accent: #0a0f0c;
		--danger: #f2a49b;
		--scrim: rgba(0, 0, 0, 0.6);
		color-scheme: dark;
	}

	@font-face {
		font-family: 'Bricolage Grotesque';
		src: url('/fonts/bricolage-grotesque-latin.woff2') format('woff2');
		font-weight: 400 600;
		font-display: swap;
	}
	@font-face {
		font-family: 'DM Mono';
		src: url('/fonts/dm-mono-400-latin.woff2') format('woff2');
		font-weight: 400;
		font-display: swap;
	}
	@font-face {
		font-family: 'DM Mono';
		src: url('/fonts/dm-mono-500-latin.woff2') format('woff2');
		font-weight: 500;
		font-display: swap;
	}

	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}
	:global(html) {
		background: var(--bg);
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font);
		font-size: 15px;
		line-height: 1.45;
		-webkit-text-size-adjust: 100%;
		-webkit-font-smoothing: antialiased;
		-webkit-tap-highlight-color: transparent;
	}
	.app {
		min-height: 100dvh;
	}
	.app.tabs {
		padding-bottom: var(--tabbar-h);
	}
	:global(main) {
		max-width: 30rem;
		margin: 0 auto;
		/* Safe-area insets for the notch and home indicator when run from the home screen. */
		padding: max(1rem, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) 2rem max(20px, env(safe-area-inset-left));
	}
	:global(h1, h2, h3) {
		text-wrap: balance;
		margin: 0;
	}
	:global(a) {
		color: var(--accent);
	}
	:global(button, input, textarea, select) {
		font: inherit;
		color: inherit;
	}
	:global(:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* Shared building blocks */
	:global(.num) {
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
	}
	:global(.btn) {
		min-height: 48px;
		border-radius: var(--radius);
		border: 0;
		background: var(--surface-2);
		color: var(--text);
		font-weight: 500;
		font-size: 15px;
		padding: 0 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		cursor: pointer;
		text-decoration: none;
		transition: transform 80ms ease;
	}
	:global(.btn:active:not(:disabled)) {
		transform: scale(0.98);
	}
	:global(.btn:disabled) {
		opacity: 0.4;
		cursor: default;
	}
	:global(.btn.primary) {
		background: var(--accent);
		color: var(--on-accent);
	}
	:global(.btn.ghost) {
		background: none;
		color: var(--soft);
	}
	:global(.btn.small) {
		min-height: 44px;
		font-size: 14px;
		padding: 0 14px;
	}
	:global(.btn.full) {
		width: 100%;
	}
	:global(.icon-btn) {
		width: 44px;
		height: 44px;
		border-radius: var(--radius);
		border: 0;
		background: none;
		color: var(--text);
		display: inline-grid;
		place-items: center;
		cursor: pointer;
		text-decoration: none;
	}
	:global(.icon-btn:active) {
		background: var(--surface-2);
	}
	:global(button.link) {
		background: none;
		border: none;
		min-height: 44px;
		padding: 0 4px;
		color: var(--muted);
		font-size: 14px;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	:global(.label) {
		font-size: 13px;
		font-weight: 500;
		color: var(--muted);
	}
	:global(.muted) {
		color: var(--muted);
	}
	:global(.error) {
		color: var(--danger);
	}
	:global(.tag) {
		font-family: var(--font);
		font-size: 9.5px;
		font-weight: 600;
		letter-spacing: 0.02em;
		padding: 3px 6px;
		border-radius: 8px;
		background: var(--accent);
		color: var(--on-accent);
		white-space: nowrap;
	}
	:global(.tag.quiet) {
		background: var(--surface-2);
		color: var(--soft);
	}
	:global(.pagehead) {
		padding-top: 12px;
		display: grid;
		gap: 6px;
	}
	:global(.pagehead h1) {
		font-size: 40px;
		font-weight: 600;
		line-height: 1.05;
		letter-spacing: 0.01em;
		color: var(--heading);
	}
	:global(.section-title) {
		margin: 28px 0 10px;
		font-size: 13px;
		font-weight: 500;
		color: var(--muted);
	}
	:global(.sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	:global(.toast) {
		position: fixed;
		left: 50%;
		bottom: calc(96px + env(safe-area-inset-bottom, 0px));
		transform: translateX(-50%);
		z-index: 40;
		background: var(--text);
		color: var(--bg);
		padding: 10px 16px;
		border-radius: var(--radius);
		font-size: 14px;
		max-width: calc(100vw - 40px);
		display: flex;
		gap: 12px;
		align-items: center;
	}
	:global(.toast button) {
		background: none;
		border: 0;
		color: inherit;
		font-weight: 600;
		text-decoration: underline;
		padding: 0;
		cursor: pointer;
	}
</style>
