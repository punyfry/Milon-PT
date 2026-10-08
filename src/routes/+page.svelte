<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import { daysAgo, formatSeconds } from '$lib/format';
	import type { ActiveSession } from '$lib/model';
	import { clearActiveSession, loadActiveSession } from '$lib/session/storage';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let active = $state<ActiveSession | null>(null);
	let now = $state(new Date());
	/** The workout waiting for a decision when another one is already in progress. */
	let pendingStart = $state<string | null>(null);

	onMount(() => {
		active = loadActiveSession();
		const t = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(t);
	});

	const activeName = $derived(
		active ? (data.cards.find((c) => c.slug === active!.workoutSlug)?.name ?? active.workoutSlug) : ''
	);
	const dateLabel = $derived(
		new Date(`${data.today}T12:00:00Z`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
	);
	const greeting = $derived(page.data.firstName ? `Hej ${page.data.firstName}` : 'Hej');
	const goal = $derived(data.week.goal);

	/** A workout in progress continues on its version; a prepared one opens the latest (see the pass page). */
	function continueHref(a: ActiveSession) {
		return a.preparing ? `/pass/${a.workoutSlug}` : `/pass/${a.workoutSlug}?v=${a.workoutVersion}`;
	}

	/** The cards are plain links; if another workout is in progress we ask first. A prepared one simply gives way. */
	function start(e: MouseEvent, slug: string) {
		if (!active || active.preparing) return;
		e.preventDefault();
		if (active.workoutSlug === slug) return void goto(continueHref(active));
		pendingStart = slug;
	}

	function discardAndStart() {
		const slug = pendingStart;
		clearActiveSession();
		active = null;
		pendingStart = null;
		if (slug) void goto(`/pass/${slug}`);
	}

	function preview(names: string[]) {
		return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
	}
</script>

<svelte:head><title>Milon-PT</title></svelte:head>

<main>
	<header class="greet">
		<span class="label date">{dateLabel}</span>
		<h1>{greeting}</h1>
	</header>

	<div class="weekline">
		{#if goal}
			<span class="weekbar" aria-hidden="true">
				{#each Array.from({ length: goal }, (_, i) => i) as i (i)}<i class:on={i < data.week.sessions}></i>{/each}
			</span>
			<span>Vecka {data.week.number} · {data.week.sessions} av {goal} pass</span>
		{:else}
			<span>Vecka {data.week.number} · {data.week.sessions} pass</span>
		{/if}
	</div>

	{#if active}
		<a class="continue" href={continueHref(active)}>
			<span class="eyebrow">{active.preparing ? 'Förberett pass' : 'Pågående pass'}</span>
			<strong>{activeName}</strong>
			<span class="meta">
				{#if active.preparing}
					{active.exercises.length} övningar · inte startat
				{:else}
					Övning {(active.current ?? 0) + 1} av {active.exercises.length} ·
					<span class="num">{formatSeconds((now.getTime() - Date.parse(active.startedAt)) / 1000)}</span>
				{/if}
			</span>
		</a>
	{/if}

	{#if data.cards.length === 0}
		<section class="empty">
			<h2>Inga pass än</h2>
			<p class="muted">
				{data.coach ? 'Bygg ditt första pass tillsammans med Milon' : 'Bygg ditt första pass'}, eller importera dina pass från Craft.
			</p>
			<a class="btn primary full" href="/skapa">Skapa pass</a>
			<a class="btn full" href="/konto#import">Importera från Craft</a>
		</section>
	{:else}
		<div class="section-title">Dina pass</div>
		<ul class="cards">
			{#each data.cards as card (card.slug)}
				{@const running = active?.workoutSlug === card.slug}
				<li>
					<a class="card" href={running && active ? continueHref(active) : `/pass/${card.slug}`} onclick={(e) => start(e, card.slug)}>
						<span class="top">
							<strong>{card.name}</strong>
							{#if !running && card.lastTrainedAt}<span class="when">{daysAgo(card.lastTrainedAt, now)}</span>{/if}
						</span>
						{#if running}<span class="running">{active?.preparing ? 'Förberett' : 'Pågår'} · tryck för att fortsätta</span>{/if}
						<span class="exs">{preview(card.exerciseNames)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

{#if pendingStart}
	<Sheet title="Ett annat pass pågår" onclose={() => (pendingStart = null)}>
		<h2 class="sheet-title">Ett annat pass pågår</h2>
		<p class="muted">{activeName} är inte avslutat. Startar du ett nytt pass slängs det utan att något loggas.</p>
		<button class="btn primary full" onclick={() => active && goto(continueHref(active))}>Fortsätt {activeName}</button>
		<button class="btn full" onclick={discardAndStart}>Släng och starta nytt</button>
		<button class="btn ghost full" onclick={() => (pendingStart = null)}>Avbryt</button>
	</Sheet>
{/if}

<style>
	.greet {
		padding-top: 16px;
		display: grid;
		gap: 4px;
	}
	.date::first-letter {
		text-transform: uppercase;
	}
	.greet h1 {
		font-size: 40px;
		font-weight: 600;
		line-height: 1.05;
		letter-spacing: 0.01em;
		color: var(--heading);
	}
	.weekline {
		margin-top: 18px;
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 14px;
		color: var(--soft);
	}
	.weekbar {
		display: flex;
		gap: 4px;
	}
	.weekbar i {
		width: 22px;
		height: 4px;
		border-radius: 2px;
		background: var(--seg);
	}
	.weekbar i.on {
		background: var(--accent);
	}
	.continue {
		margin-top: 24px;
		display: grid;
		gap: 2px;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--on-accent);
		padding: 16px 18px;
		text-decoration: none;
	}
	.continue .eyebrow,
	.continue .meta {
		font-size: 14px;
		opacity: 0.85;
	}
	.continue strong {
		font-size: 22px;
		font-weight: 600;
	}
	.continue .num {
		font-size: 13px;
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	.card {
		display: grid;
		gap: 4px;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius);
		padding: 16px 18px;
		color: var(--text);
		text-decoration: none;
	}
	.card:active {
		background: var(--surface-2);
	}
	.card .top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}
	.card strong {
		font-size: 20px;
		font-weight: 600;
	}
	.when {
		font-size: 13px;
		color: var(--muted);
		white-space: nowrap;
	}
	.exs {
		font-size: 14px;
		color: var(--soft);
	}
	.running {
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
	}
	.empty {
		margin-top: 28px;
		display: grid;
		gap: 10px;
	}
	.empty h2 {
		font-size: 20px;
		font-weight: 600;
	}
	.empty p {
		margin: 0 0 8px;
	}
</style>
