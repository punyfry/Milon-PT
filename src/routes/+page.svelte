<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { daysAgo, timeAgo } from '$lib/format';
	import type { ActiveSession } from '$lib/model';
	import { clearActiveSession, loadActiveSession } from '$lib/session/storage';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let active = $state<ActiveSession | null>(null);
	let now = $state(new Date());

	onMount(() => {
		active = loadActiveSession();
		const t = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(t);
	});

	const activeName = $derived(
		active ? (data.cards.find((c) => c.slug === active!.workoutSlug)?.name ?? active.workoutSlug) : ''
	);

	function continueHref(a: ActiveSession) {
		return `/pass/${a.workoutSlug}?v=${a.workoutVersion}`;
	}

	function abort() {
		if (!confirm('Avbryta passet? Inget av det loggas.')) return;
		clearActiveSession();
		active = null;
	}

	/** Korten är vanliga länkar; finns ett pågående pass frågar vi först. */
	function start(e: MouseEvent, slug: string) {
		if (!active) return;
		e.preventDefault();
		if (active.workoutSlug === slug) return void goto(continueHref(active));
		if (!confirm(`Du har ett pågående pass (${activeName}). Avbryta det och starta ett nytt?`)) return;
		clearActiveSession();
		active = null;
		void goto(`/pass/${slug}`);
	}
</script>

<svelte:head><title>Milon-PT</title></svelte:head>

<main>
	{#if active}
		<section class="continue">
			<a class="card primary" href={continueHref(active)}>
				<span class="eyebrow">Fortsätt pågående pass</span>
				<strong>{activeName}</strong>
				<span class="meta">Senaste aktivitet {timeAgo(active.lastActivityAt, now)}</span>
			</a>
			<button class="link danger" onclick={abort}>Avbryt pass</button>
		</section>
	{/if}

	{#if data.cards.length === 0}
		<p class="empty">Inga pass än. Skapa ett pass eller importera dina pass från Craft.</p>
	{:else}
		<ul class="cards">
			{#each data.cards as card (card.slug)}
				<li>
					<a class="card" href={`/pass/${card.slug}`} onclick={(e) => start(e, card.slug)}>
						<strong>{card.name}</strong>
						<span class="meta">
							{card.exerciseCount} övningar
							{#if card.lastTrainedAt}· Senast: {daysAgo(card.lastTrainedAt, now)}{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<nav class="secondary">
		<a href="/historik">Historik</a>
		<a href="/skapa">Skapa pass</a>
		<a href="/konto">Konto</a>
	</nav>
</main>

<style>
	.continue {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.cards {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.75rem;
	}
	.card {
		display: grid;
		gap: 0.25rem;
		width: 100%;
		text-align: left;
		padding: 1.1rem 1.2rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.card strong {
		font-size: 1.25rem;
	}
	.card.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.card.primary .meta {
		color: inherit;
		opacity: 0.85;
	}
	.eyebrow {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.meta {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.empty {
		color: var(--muted);
	}
	.secondary {
		display: flex;
		gap: 1.25rem;
		margin-top: 2rem;
		justify-content: center;
	}
	.secondary a {
		color: var(--muted);
	}
</style>
