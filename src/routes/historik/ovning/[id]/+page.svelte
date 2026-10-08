<script lang="ts">
	import { enhance } from '$app/forms';
	import ExerciseFields from '$lib/components/ExerciseFields.svelte';
	import LineChart from '$lib/components/LineChart.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import type { ExerciseType } from '$lib/model';
	import { formatMetric, formatNumber, formatSeconds } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// --- editing name, type and instruction -----------------------------------
	let editing = $state(false);
	let fields = $state({ name: '', type: 'weight' as ExerciseType, instruction: '' });
	let editError = $state<string | null>(null);

	// --- deleting -------------------------------------------------------------
	let confirmDelete = $state(false);
	let deleteError = $state<string | null>(null);
	let deleting = $state(false);

	function openDelete() {
		deleteError = null;
		confirmDelete = true;
	}

	function openEdit() {
		fields = { name: ex.name, type: ex.type, instruction: ex.instruction };
		editError = null;
		editing = true;
	}

	const ex = $derived(data.exercise);
	const fmt = (n: number) => formatMetric(ex.type, n);
	const thisYear = String(new Date().getFullYear());
	const date = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', {
			day: 'numeric',
			month: 'short',
			...(d.startsWith(thisYear) ? {} : { year: 'numeric' }),
			timeZone: 'UTC'
		}).replace('.', '');
	/** "62,5×8 · 60×7", "9 · 8 reps", "0:45 · 1:00" */
	function setsText(sets: { weight?: number; reps?: number; seconds?: number }[]) {
		if (ex.type === 'weight') return sets.map((s) => `${formatNumber(s.weight ?? 0)}×${s.reps ?? 0}`).join(' · ');
		if (ex.type === 'time') return sets.map((s) => formatSeconds(s.seconds ?? 0)).join(' · ');
		return `${sets.map((s) => s.reps ?? 0).join(' · ')} reps`;
	}
	const volumeText = (v: number) =>
		ex.type === 'weight' ? `${formatNumber(v)} kg` : ex.type === 'time' ? formatSeconds(v) : `${v} reps`;
	/** Screen reader text for the PR tag: "rekord", "rekord i tyngsta vikt" or "rekord i 1RM och tyngsta vikt". */
	function recordLabel(kinds: string[]) {
		if (ex.type !== 'weight') return 'rekord';
		return `rekord i ${kinds.map((k) => (k === 'heaviest' ? 'tyngsta vikt' : '1RM')).join(' och ')}`;
	}
	const best = $derived(data.points.reduce((b, p) => Math.max(b, p.value), 0));
	/** Exercise type, shown above the name. */
	const kind = $derived(ex.type === 'weight' ? 'Vikt' : ex.type === 'time' ? 'Tid' : 'Kroppsvikt');
</script>

<svelte:head><title>{ex.name} · Historik · Milon-PT</title></svelte:head>

<header class="topbar">
	<a class="icon-btn" href="/historik" aria-label="Tillbaka till historik"><Icon name="left" /></a>
	<span class="label">Historik</span>
	{#if !ex.deleted}<button class="btn small edit" onclick={openEdit}>Ändra</button>{/if}
</header>

<main>
	<div class="pagehead">
		<span class="label">{kind}{ex.deleted ? ' · borttagen' : ''}</span>
		<h1>{ex.name}</h1>
	</div>

	<section class="chart">
		<div class="head">
			<span class="label">{data.metric.label}</span>
			{#if data.points.length}<span class="best num">{fmt(best)}</span>{/if}
		</div>
		{#if data.points.length > 1}
			<LineChart
				points={data.points}
				label="{data.metric.label} för {ex.name} över tid"
				kind={ex.type === 'time' ? 'seconds' : ex.type === 'bodyweight' ? 'integer' : 'number'}
				format={fmt}
			/>
		{:else if data.points.length === 1}
			<p class="muted">Ett pass hittills. Grafen visas från två pass.</p>
		{:else}
			<p class="muted">Inga loggade set än.</p>
		{/if}
		{#if ex.type === 'weight'}<p class="muted formula">Beräknas som vikt × (1 + reps / 30).</p>{/if}
	</section>

	{#if data.entries.length}
		<div class="section-title">Senaste passen</div>
		<ul class="entries">
			{#each data.entries as e, i (i)}
				<li>
					<div class="top">
						{#if e.sessionId}
							<a class="date" href={`/historik/pass/${e.sessionId}`} aria-label="{date(e.date)}, visa passet">{date(e.date)} <Icon name="right" size={14} /></a>
						{:else}
							<span class="date">{date(e.date)}</span>
						{/if}
						<span class="value num">
							{#if e.record.length}<span class="tag" title={recordLabel(e.record)}>PR<span class="sr-only">, {recordLabel(e.record)}</span></span>{/if}
							{e.best === null ? '–' : fmt(e.best)}
						</span>
					</div>
					<div class="sets num">{setsText(e.sets)}</div>
					{#if e.note}<p class="note">{e.note}</p>{/if}
					<div class="vol num">Volym {volumeText(e.volume)}</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if ex.instruction}
		<details>
			<summary>Instruktion</summary>
			<p class="instruction">{ex.instruction}</p>
		</details>
	{/if}

	{#if !ex.deleted}<button class="btn ghost full remove" onclick={openDelete}>Ta bort övning</button>{/if}
</main>

{#if editing}
	<Sheet title="Ändra övning" onclose={() => (editing = false)}>
		<form
			method="POST"
			action="?/edit"
			class="editform"
			use:enhance={() =>
				async ({ result, update }) => {
					if (result.type === 'success') editing = false;
					else if (result.type === 'failure') editError = String(result.data?.editError ?? 'Kunde inte spara.');
					await update({ reset: false });
				}}
		>
			<h2>Ändra övning</h2>
			<ExerciseFields bind:name={fields.name} bind:type={fields.type} bind:instruction={fields.instruction} typeLock={ex.typeLock} idPrefix="edit" />
			<input type="hidden" name="name" value={fields.name} />
			<input type="hidden" name="type" value={fields.type} />
			<input type="hidden" name="instruction" value={fields.instruction} />
			{#if editError}<p class="error" role="alert">{editError}</p>{/if}
			<button type="submit" class="btn primary full">Spara</button>
			<button type="button" class="btn ghost full" onclick={() => (editing = false)}>Avbryt</button>
		</form>
	</Sheet>
{/if}

{#if confirmDelete}
	<Sheet title="Ta bort övningen?" onclose={() => (confirmDelete = false)}>
		<form
			method="POST"
			action="?/delete"
			class="editform"
			use:enhance={() => {
				deleting = true;
				return async ({ result, update }) => {
					deleting = false;
					if (result.type === 'failure') deleteError = String(result.data?.deleteError ?? 'Kunde inte ta bort övningen.');
					else await update();
				};
			}}
		>
			<h2>Ta bort övningen?</h2>
			{#if ex.deleteLock}
				<p>{ex.deleteLock}</p>
				<button type="button" class="btn primary full" onclick={() => (confirmDelete = false)}>OK</button>
			{:else}
				<p class="muted">{ex.name} försvinner ur listan med övningar och går inte längre att välja i ett pass. Loggade set finns kvar i passen där de gjordes.</p>
				{#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
				<button type="submit" class="btn primary full" disabled={deleting}>{deleting ? 'Tar bort…' : 'Ta bort övningen'}</button>
				<button type="button" class="btn ghost full" onclick={() => (confirmDelete = false)}>Avbryt</button>
			{/if}
		</form>
	</Sheet>
{/if}

<style>
	.edit {
		justify-self: end;
	}
	.remove {
		margin-top: 24px;
	}
	.editform {
		display: grid;
		gap: 12px;
	}
	.editform h2 {
		font-size: 20px;
		font-weight: 600;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		max-width: 30rem;
		margin: 0 auto;
		height: calc(56px + env(safe-area-inset-top, 0px));
		padding: env(safe-area-inset-top, 0px) 8px 0 6px;
		display: grid;
		grid-template-columns: 72px 1fr 72px;
		align-items: center;
		text-align: center;
		background: var(--bg);
	}
	main {
		padding-top: 0;
	}
	.chart {
		margin-top: 20px;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 14px 16px;
		min-width: 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 6px;
	}
	.best {
		font-size: 28px;
		font-weight: 500;
		letter-spacing: -0.04em;
		color: var(--accent);
	}
	.formula {
		margin: 8px 0 0;
		font-size: 12px;
	}
	.entries {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.entries li {
		border-bottom: 1px solid var(--line);
		padding: 12px 0;
		display: grid;
		gap: 4px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}
	.date {
		font-size: 14px;
		font-weight: 500;
	}
	a.date {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		color: var(--text);
		text-decoration: none;
	}
	a.date :global(svg) {
		color: var(--muted);
	}
	.value {
		font-size: 15px;
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.sets {
		font-size: 13px;
		color: var(--soft);
		overflow-wrap: anywhere;
	}
	.note {
		margin: 0;
		overflow-wrap: anywhere;
		font-size: 13px;
		color: var(--muted);
		white-space: pre-line;
	}
	.vol {
		font-size: 12px;
		color: var(--muted);
	}
	details {
		margin-top: 20px;
	}
	summary {
		min-height: 44px;
		display: flex;
		align-items: center;
		color: var(--soft);
		cursor: pointer;
	}
	.instruction {
		margin: 0 0 12px;
		white-space: pre-line;
		color: var(--soft);
		font-size: 14px;
	}
</style>
