<script lang="ts">
	import LineChart from '$lib/components/LineChart.svelte';
	import { formatMetric, formatNumber, formatSeconds } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const weekdays = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
	const dayNum = (d: string) => Number(d.slice(8, 10));
	const thisYear = $derived(data.today.slice(0, 4));
	/** "3 okt." i år, annars "3 jan. 2021". */
	const shortDate = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', {
			day: 'numeric',
			month: 'short',
			...(d.startsWith(thisYear) ? {} : { year: 'numeric' }),
			timeZone: 'UTC'
		});
	/** "tisdag 6 oktober" för skärmläsare. */
	const longDate = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
	const range = $derived(`${shortDate(data.week.days[0].date)} – ${shortDate(data.week.days[6].date)}`);
	const weekYear = $derived(data.week.days[3].date.slice(0, 4));
	const kindFor = (type: string): 'seconds' | 'integer' | 'number' =>
		type === 'time' ? 'seconds' : type === 'bodyweight' ? 'integer' : 'number';
	const v = $derived(data.week.volumeByType);
	const active = $derived(data.exercises.filter((e) => !e.archived));
	const archived = $derived(data.exercises.filter((e) => e.archived));
</script>

<svelte:head><title>Historik · Milon-PT</title></svelte:head>

<main>
	<p><a href="/" class="back">← Start</a></p>
	<h1>Historik</h1>

	<section class="card week" aria-label="Vecka {data.week.week}">
		<div class="week-head">
			{#if data.prevWeek}
				<a href={`/historik?vecka=${data.prevWeek}`} aria-label="Föregående vecka">←</a>
			{:else}
				<span class="placeholder" aria-hidden="true"></span>
			{/if}
			<div>
				<strong>{data.isCurrentWeek ? 'Denna vecka' : `Vecka ${data.week.week}${weekYear !== thisYear ? `, ${weekYear}` : ''}`}</strong>
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
				<li
					class:trained={day.trained}
					class:today={day.date === data.today}
					aria-label="{longDate(day.date)}, {day.trained ? 'tränat' : 'vila'}"
					aria-current={day.date === data.today ? 'date' : undefined}
				>
					<span class="wd" aria-hidden="true">{weekdays[i]}</span>
					<span class="dot" aria-hidden="true"></span>
					<span class="num" aria-hidden="true">{dayNum(day.date)}</span>
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
				<h3>
					{m.title}
					{#if m.exercise && m.exercise.name !== m.title}<span class="meta">· {m.progress ? 'på väg: ' : ''}{m.exercise.name}</span>{/if}
				</h3>
				{#if m.exercise && m.points.length > 1}
					<LineChart
						points={m.points}
						height={120}
						label="{m.exercise.name} över tid"
						kind={kindFor(m.exercise.type)}
						format={(n) => formatMetric(m.exercise!.type, n)}
					/>
					<a class="more" href={`/historik/ovning/${m.exercise.id}`} aria-label="Alla pass med {m.exercise.name}">Alla pass</a>
				{:else if m.exercise && m.points.length === 1}
					<p class="meta">
						{m.exercise.name}: ett pass hittills, {formatMetric(m.exercise.type, m.points[0].value)}. Grafen visas från två pass.
					</p>
				{:else if m.exercise}
					<p class="meta">Ingen historik för {m.exercise.name} än.</p>
				{:else}
					<p class="meta">Ingen övning som heter {m.title} än.</p>
				{/if}
				{#if m.others.length}
					<p class="meta others">
						Även:
						{#each m.others as o, i (o.id)}{i ? ', ' : ''}<a href={`/historik/ovning/${o.id}`}>{o.name}</a>{/each}
					</p>
				{/if}
			</section>
		{/each}
	</div>

	{#snippet exerciseList(list: typeof data.exercises)}
		<ul class="card list">
			{#each list as ex (ex.id)}
				<li>
					<a href={`/historik/ovning/${ex.id}`}>
						<span class="name">{ex.name}</span>
						<span class="meta">{ex.metric}: {formatMetric(ex.type, ex.best)} · senast {shortDate(ex.lastDate)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/snippet}

	<h2>Övningar</h2>
	{#if active.length}
		{@render exerciseList(active)}
	{:else if !archived.length}
		<p class="meta">Inga loggade pass än.</p>
	{/if}
	{#if archived.length}
		<details class="archived">
			<summary>Arkiverade ({archived.length})</summary>
			{@render exerciseList(archived)}
		</details>
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
		grid-template-columns: minmax(0, 1fr);
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
	.archived {
		margin-top: 1rem;
	}
	.archived summary {
		cursor: pointer;
		color: var(--muted);
		padding: 0.25rem 0;
		margin-bottom: 0.5rem;
	}
</style>
