<script lang="ts">
	import { navigating, page } from '$app/state';
	import Icon from './Icon.svelte';

	const tabs = [
		{ href: '/', label: 'Start', icon: 'home' },
		{ href: '/historik', label: 'Bibliotek', icon: 'chart' },
		{ href: '/skapa', label: 'Skapa', icon: 'plus' },
		{ href: '/konto', label: 'Konto', icon: 'user' }
	] as const;

	const matches = (href: string, pathname: string) =>
		href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
	/** While a view loads, the tapped tab is highlighted right away so the tap is seen to work. */
	const shown = $derived(navigating.to?.url.pathname ?? page.url.pathname);
</script>

<!-- The tabs' code is fetched up front; their data still loads on tap (preload-data in app.html). -->
<nav aria-label="Huvudmeny" data-sveltekit-preload-code="eager">
	{#each tabs as t (t.href)}
		<a href={t.href} aria-current={matches(t.href, page.url.pathname) ? 'page' : undefined} class:on={matches(t.href, shown)}>
			<Icon name={t.icon} />
			<span>{t.label}</span>
		</a>
	{/each}
</nav>

<style>
	nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		background: var(--bg);
		border-top: 1px solid var(--line);
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	a {
		min-height: 60px;
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 3px;
		color: var(--muted);
		font-size: 12px;
		font-weight: 500;
		text-decoration: none;
	}
	a.on {
		color: var(--text);
	}
	a.on :global(svg) {
		stroke: var(--accent);
	}
</style>
