<script lang="ts">
	import { page } from '$app/state';
	import Icon from './Icon.svelte';

	const tabs = [
		{ href: '/', label: 'Start', icon: 'home' },
		{ href: '/historik', label: 'Historik', icon: 'chart' },
		{ href: '/skapa', label: 'Skapa', icon: 'plus' },
		{ href: '/konto', label: 'Konto', icon: 'user' }
	] as const;

	const current = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<nav aria-label="Huvudmeny">
	{#each tabs as t (t.href)}
		<a href={t.href} aria-current={current(t.href) ? 'page' : undefined}>
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
	a[aria-current='page'] {
		color: var(--text);
	}
	a[aria-current='page'] :global(svg) {
		stroke: var(--accent);
	}
</style>
