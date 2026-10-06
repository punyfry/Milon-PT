<script lang="ts">
	import LineChart from '$lib/components/LineChart.svelte';
	import { formatMetric, formatNumber, formatSeconds } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const weekdays = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
	const dayNum = (d: string) => Number(d.slice(8, 10));
	const shortDate = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	const range = $derived(`${shortDate(data.week.days[0].date)} – ${shortDate(data.week.days[6].date)}`);
	const v = $derived(data.week.volumeByType);
</script>

<svelte:head><title>Historik · Milon-PT</title></svelte:head>

<main>
	<p><a href="/" class="back">← Start</a></p>
	<h1>Historik</h1>

	<section class="card week" aria-label="Vecka {data.week.week}">
		<div class="week-head">
			<a href={`/historik?vecka=${data.prevWeek}`} aria-label="Föregående vecka">←</a>
			<div>
				<strong>{data.isCurrentWeek ? 'Denna vecka' : `Vecka ${data.week.week}`}</strong>
				<span class="meta">{range}</span>
			</div>
			{#if data.nextWeek}
				<a href={`/historik?vecka=${data.nextWeek}`} aria-label="Nästa vecka">→</a>
			{:else}
				<span class="placeholder" aria-hidden="true"></span>
			{/if}
		</div>

		<ol class="strip">
			{#each data.week.days as day, i (day.date)}
				<li class:trained={day.trained} class:today={day.date === data.today}>
					<span class="wd">{weekdays[i]}</span>
					<span class="dot" aria-hidden="true"></span>
					<span class="num">{dayNum(day.date)}</span>
					<span class="sr">{day.trained ? 'tränat' : 'vila'}</span>
				</li>
			{/each}
		</ol>

		<div class="tiles">
			<div class="tile">
				<span class="label">Pass</span>
				<span class="value">
					{data.week.sessionCount}{#if data.weeklyGoal}<span class="of">&nbsp;av {data.weeklyGoal}</span>{/if}
				</span>
				{#if !data.weeklyGoal}<a class="hint" href="/konto">Sätt veckomål</a>{/if}
			</div>
			<div class="tile">
				<span class="label">Volym</span>
				<span class="value small">
					{#if v.weight}<span>{formatNumber(v.weight)} kg</span>{/if}
					{#if v.bodyweight}<span>{formatNumber(v.bodyweight)} reps</span>{/if}
					{#if v.time}<span>{formatSeconds(v.time)}</span>{/if}
					{#if !v.weight && !v.bodyweight && !v.time}<span>–</span>{/if}
				</span>
			</div>
		</div>
	</section>

	<h2>Milstolpar</h2>
	<div class="milestones">
		{#each data.milestones as m (m.key)}
			<section class="card">
				<h3>{m.title}</h3>
				{#if m.exercise && m.points.length}
					<LineChart
						points={m.points}
						height={120}
						label="{m.title} över tid"
						format={(n) => formatMetric(m.exercise!.type, n)}
					/>
					<a class="more" href={`/historik/ovning/${m.exercise.id}`}>Alla pass</a>
				{:else if m.exercise}
					<p class="meta">Ingen historik för {m.exercise.name} än.</p>
				{:else}
					<p class="meta">Ingen övning som heter {m.title} än.</p>
				{/if}
			</section>
		{/each}
	</div>

	<h2>Övningar</h2>
	{#if data.exercises.length}
		<ul class="card list">
			{#each data.exercises as ex (ex.id)}
				<li>
					<a href={`/historik/ovning/${ex.id}`}>
						<span class="name">{ex.name}</span>
						<span class="meta">{ex.metric}: {formatMetric(ex.type, ex.best)} · senast {shortDate(ex.lastDate)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="meta">Inga loggade pass än.</p>
	{/if}
</main>

<style>
	.back {
		color: var(--muted);
		text-decoration: none;
	}
	h1 {
		margin: 0.25rem 0 1rem;
	}
	h2 {
		font-size: 1.05rem;
		margin: 1.5rem 0 0.5rem;
	}
	h3 {
		font-size: 1rem;
		margin: 0 0 0.5rem;
	}
	.meta {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 1rem;
	}
	.week-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		text-align: center;
	}
	.week-head div {
		display: grid;
	}
	.week-head a,
	.placeholder {
		width: 2.5rem;
		height: 2.5rem;
		display: grid;
		place-items: center;
		text-decoration: none;
		font-size: 1.2rem;
		color: var(--text);
	}
	.strip {
		list-style: none;
		padding: 0;
		margin: 0.9rem 0;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		text-align: center;
	}
	.strip li {
		display: grid;
		justify-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0;
		border-radius: 10px;
	}
	.strip li.today {
		outline: 1px solid var(--border);
	}
	.wd {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.dot {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		border: 1px solid var(--border);
	}
	.trained .dot {
		background: var(--series);
		border-color: var(--series);
	}
	.num {
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.tiles {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.tile {
		display: grid;
		gap: 0.15rem;
		align-content: start;
	}
	.label {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.value {
		font-size: 1.6rem;
		font-weight: 600;
	}
	.value.small {
		font-size: 1rem;
		display: grid;
	}
	.of {
		font-size: 1rem;
		font-weight: 400;
		color: var(--muted);
	}
	.hint {
		font-size: 0.85rem;
	}
	.milestones {
		display: grid;
		gap: 0.75rem;
	}
	.more {
		display: inline-block;
		margin-top: 0.4rem;
		font-size: 0.9rem;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.list li + li {
		border-top: 1px solid var(--border);
	}
	.list a {
		display: grid;
		gap: 0.1rem;
		padding: 0.65rem 1rem;
		text-decoration: none;
		color: var(--text);
	}
	.name {
		font-weight: 600;
	}
</style>
