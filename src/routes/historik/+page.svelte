<script lang="ts">
	import { enhance } from '$app/forms';
	import ExerciseFields from '$lib/components/ExerciseFields.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import type { ExerciseType } from '$lib/model';
	import LineChart from '$lib/components/LineChart.svelte';
	import { formatDuration, formatMetric, formatNumber, formatSeconds } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// --- a new exercise on its own (#64) -----------------------------------
	let creating = $state(false);
	let fresh = $state({ name: '', type: 'weight' as ExerciseType, instruction: '', note: '' });
	let createError = $state<string | null>(null);
	let saving = $state(false);

	function openCreate() {
		fresh = { name: '', type: 'weight', instruction: '', note: '' };
		createError = null;
		creating = true;
	}

	const weekdays = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
	const dayNum = (d: string) => Number(d.slice(8, 10));
	const thisYear = $derived(data.today.slice(0, 4));
	/** "3 okt" this year, otherwise "3 jan 2021". */
	const shortDate = (d: string) =>
		new Date(`${d}T12:00:00Z`)
			.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', ...(d.startsWith(thisYear) ? {} : { year: 'numeric' }), timeZone: 'UTC' })
			.replace('.', '');
	/** "tisdag 6 oktober" for screen readers. */
	const longDate = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
	const range = $derived(`${shortDate(data.week.days[0].date)} – ${shortDate(data.week.days[6].date)}`);
	const weekYear = $derived(data.week.days[3].date.slice(0, 4));
	const kindFor = (type: string): 'seconds' | 'integer' | 'number' => (type === 'time' ? 'seconds' : type === 'bodyweight' ? 'integer' : 'number');
	const v = $derived(data.week.volumeByType);
	/** "Beräknad 1RM" → "1RM" in the list, where it fits next to the value. */
	const shortMetric = (m: string) => (m.includes('1RM') ? '1RM ' : '');

	let query = $state('');
	const q = $derived(query.trim().toLocaleLowerCase('sv'));
	const groups = $derived(
		data.groups
			.map((g) => ({ ...g, exercises: g.exercises.filter((e) => !q || e.name.toLocaleLowerCase('sv').includes(q)) }))
			.filter((g) => g.exercises.length)
	);
</script>

<svelte:head><title>Bibliotek · Milon-PT</title></svelte:head>

<main>
	<div class="pagehead">
		<span class="label">Bibliotek</span>
		<h1>Din träning</h1>
	</div>

	<section class="week" aria-label="Vecka {data.week.week}">
		<div class="week-head">
			{#if data.prevWeek}
				<a class="icon-btn" href={`/historik?vecka=${data.prevWeek}`} aria-label="Föregående vecka"><Icon name="left" /></a>
			{:else}
				<span></span>
			{/if}
			<div>
				<strong>{data.isCurrentWeek ? 'Denna vecka' : `Vecka ${data.week.week}${weekYear !== thisYear ? `, ${weekYear}` : ''}`}</strong>
				<span>{range}</span>
			</div>
			{#if data.nextWeek}
				<a class="icon-btn" href={`/historik?vecka=${data.nextWeek}`} aria-label="Nästa vecka"><Icon name="right" /></a>
			{:else}
				<span></span>
			{/if}
		</div>

		<ol class="strip">
			{#each data.week.days as day, i (day.date)}
				<li
					class:trained={day.trained}
					class:today={day.date === data.today}
					aria-label="{longDate(day.date)}, {day.trained ? 'tränat' : 'vila'}{day.date === data.today ? ', i dag' : ''}"
					aria-current={day.date === data.today ? 'date' : undefined}
				>
					<span class="wd" aria-hidden="true">{weekdays[i]}</span>
					<span class="dot" aria-hidden="true"></span>
					<span class="d num" aria-hidden="true">{dayNum(day.date)}</span>
				</li>
			{/each}
		</ol>

		<div class="stats">
			<div>
				<div class="label">Pass</div>
				<div class="big num">
					{data.week.sessionCount}{#if data.weeklyGoal}<small>&nbsp;av {data.weeklyGoal}</small>{/if}
				</div>
				{#if !data.weeklyGoal}<a class="hint" href="/konto">Sätt veckomål</a>{/if}
			</div>
			<dl class="vol" aria-label="Volym">
				{#if v.weight}<div><dt>Vikt</dt><dd class="num">{formatNumber(v.weight)} kg</dd></div>{/if}
				{#if v.bodyweight}<div><dt>Reps</dt><dd class="num">{formatNumber(v.bodyweight)}</dd></div>{/if}
				{#if v.time}<div><dt>Tid</dt><dd class="num">{formatSeconds(v.time)}</dd></div>{/if}
				{#if !v.weight && !v.bodyweight && !v.time}<div><dt>Ingen träning loggad</dt></div>{/if}
			</dl>
		</div>
	</section>

	{#if data.sessions.length}
		<div class="section-title">Pass {data.isCurrentWeek ? 'denna vecka' : `vecka ${data.week.week}`}</div>
		<ul class="list">
			{#each data.sessions as s (s.id)}
				<li>
					<a href={`/historik/pass/${s.id}`}>
						<span class="name">{s.name}</span>
						<span class="best num">{formatDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}</span>
						<span class="when">{longDate(s.startedAt.slice(0, 10))} · <span class="num">{s.startedAt.slice(11, 16)}</span></span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="section-title">Milstolpar</div>
	<div class="milestones">
		{#each data.milestones as m (m.key)}
			{@const last = m.points[m.points.length - 1]}
			<section class="card">
				<div class="mtop">
					<h2>{m.title}</h2>
					{#if m.exercise && last}<span class="mval num">{formatMetric(m.exercise.type, last.value)}</span>{/if}
				</div>
				{#if m.exercise && m.exercise.name !== m.title}
					<p class="muted small">{m.progress ? 'På väg: ' : ''}{m.exercise.name}</p>
				{/if}
				{#if m.exercise && m.points.length > 1}
					<LineChart points={m.points} height={110} label="{m.exercise.name} över tid" kind={kindFor(m.exercise.type)} format={(n) => formatMetric(m.exercise!.type, n)} />
					<a class="more" href={`/historik/ovning/${m.exercise.id}`}>Alla pass med {m.exercise.name}</a>
				{:else if m.exercise && m.points.length === 1}
					<p class="muted small">Ett pass hittills. Grafen visas från två pass.</p>
				{:else if m.exercise}
					<p class="muted small">Ingen historik för {m.exercise.name} än.</p>
				{:else}
					<p class="muted small">Ingen övning som heter {m.title} än.</p>
				{/if}
				{#if m.others.length}
					<p class="muted small">
						Även:
						{#each m.others as o, i (o.id)}{i ? ', ' : ''}<a href={`/historik/ovning/${o.id}`}>{o.name}</a>{/each}
					</p>
				{/if}
			</section>
		{/each}
	</div>

	{#snippet exerciseList(list: (typeof data.groups)[number]['exercises'])}
		<ul class="list">
			{#each list as ex (ex.id)}
				<li>
					<a href={`/historik/ovning/${ex.id}`}>
						<span class="name">{ex.name}</span>
						<span class="when">{ex.lastDate ? `senast ${shortDate(ex.lastDate)}` : 'inte tränad än'}</span>
						{#if ex.lastDate}<span class="best num">{shortMetric(ex.metric)}{formatMetric(ex.type, ex.best)}</span>{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/snippet}

	<div class="section-head">
		<div class="section-title">Övningar</div>
		<button class="btn small" onclick={openCreate}>Ny övning</button>
	</div>
	{#if data.groups.length}
		<label class="sr-only" for="search">Sök övning</label>
		<input id="search" class="search" type="search" placeholder="Sök övning" bind:value={query} />
		{#each groups as g (g.name)}
			<h3 class="group">{g.name}</h3>
			{@render exerciseList(g.exercises)}
		{:else}
			<p class="muted">Ingen övning matchar ”{query}”.</p>
		{/each}
	{:else}
		<p class="muted">Inga övningar än.</p>
	{/if}
</main>

{#if creating}
	<Sheet title="Ny övning" onclose={() => (creating = false)}>
		<form
			method="POST"
			action="?/create"
			class="createform"
			use:enhance={() => {
				saving = true;
				return async ({ result, update }) => {
					saving = false;
					if (result.type === 'failure') createError = String(result.data?.createError ?? 'Kunde inte spara.');
					else await update();
				};
			}}
		>
			<h2>Ny övning</h2>
			<p class="muted">Sparas i biblioteket utan att läggas i ett pass.</p>
			<ExerciseFields bind:name={fresh.name} bind:type={fresh.type} bind:instruction={fresh.instruction} bind:note={fresh.note} idPrefix="create" />
			<input type="hidden" name="name" value={fresh.name} />
			<input type="hidden" name="type" value={fresh.type} />
			<input type="hidden" name="instruction" value={fresh.instruction} />
			<input type="hidden" name="note" value={fresh.note} />
			{#if createError}<p class="error" role="alert">{createError}</p>{/if}
			<button type="submit" class="btn primary full" disabled={saving}>{saving ? 'Sparar…' : 'Spara'}</button>
			<button type="button" class="btn ghost full" onclick={() => (creating = false)}>Avbryt</button>
		</form>
	</Sheet>
{/if}

<style>
	.week {
		margin-top: 20px;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 14px 16px 16px;
	}
	.week-head {
		display: grid;
		grid-template-columns: 44px 1fr 44px;
		align-items: center;
		text-align: center;
	}
	.week-head div {
		display: grid;
	}
	.week-head strong {
		font-weight: 600;
	}
	.week-head div span {
		font-size: 13px;
		color: var(--muted);
	}
	.strip {
		list-style: none;
		padding: 0;
		margin: 12px 0 14px;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		text-align: center;
	}
	.strip li {
		display: grid;
		justify-items: center;
		gap: 6px;
		padding: 6px 0;
		border-radius: 10px;
	}
	.wd {
		font-size: 12px;
		color: var(--muted);
	}
	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1.5px solid var(--ring);
	}
	.trained .dot {
		background: var(--accent);
		border-color: var(--accent);
	}
	.d {
		font-size: 13px;
	}
	.today {
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.today .wd,
	.today .d {
		color: var(--text);
		font-weight: 600;
	}
	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		border-top: 1px solid var(--line);
		padding-top: 12px;
	}
	.big {
		font-size: 30px;
		font-weight: 500;
		letter-spacing: -0.04em;
	}
	.big small {
		font-size: 14px;
		letter-spacing: 0;
		font-weight: 400;
		color: var(--muted);
	}
	.hint {
		font-size: 13px;
	}
	.vol {
		margin: 0;
		display: grid;
		gap: 2px;
		align-content: end;
		font-size: 14px;
	}
	.vol div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.vol dt {
		color: var(--muted);
	}
	.vol dd {
		margin: 0;
	}
	.milestones {
		display: grid;
		gap: 10px;
		grid-template-columns: minmax(0, 1fr);
	}
	.card {
		background: var(--surface);
		border-radius: var(--radius);
		padding: 14px 16px;
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.mtop {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}
	.card h2 {
		font-size: 16px;
		font-weight: 600;
	}
	.mval {
		font-size: 20px;
		font-weight: 500;
		color: var(--accent);
	}
	.small {
		font-size: 13px;
		margin: 0;
	}
	.more {
		font-size: 14px;
	}
	.section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-top: 28px;
	}
	.section-head .section-title {
		margin: 0;
	}
	.section-head + * {
		margin-top: 10px;
	}
	.createform {
		display: grid;
		gap: 12px;
	}
	.createform h2 {
		font-size: 20px;
		font-weight: 600;
	}
	.createform p {
		margin: 0;
	}
	.search {
		width: 100%;
		min-height: 48px;
		border-radius: var(--radius);
		border: 0;
		background: var(--surface-2);
		padding: 0 14px;
	}
	.group {
		margin: 16px 0 4px;
		font-size: 13px;
		font-weight: 500;
		color: var(--muted);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list a {
		min-height: 56px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 12px;
		align-items: center;
		color: var(--text);
		text-decoration: none;
	}
	.name {
		font-size: 16px;
		font-weight: 500;
	}
	.when {
		font-size: 13px;
		color: var(--muted);
	}
	.best {
		grid-row: 1 / span 2;
		grid-column: 2;
		font-size: 15px;
		color: var(--soft);
	}
</style>
