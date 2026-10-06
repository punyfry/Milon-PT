<script lang="ts">
	import LineChart from '$lib/components/LineChart.svelte';
	import { formatMetric, formatNumber, formatSeconds, formatSet } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ex = $derived(data.exercise);
	const fmt = (n: number) => formatMetric(ex.type, n);
	const thisYear = String(new Date().getFullYear());
	const date = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', {
			day: 'numeric',
			month: 'short',
			...(d.startsWith(thisYear) ? {} : { year: 'numeric' }),
			timeZone: 'UTC'
		});
	/** "62,5 kg × 8, 60 kg × 7", "9, 8 reps", "45, 60 s" */
	function setsText(sets: { weight?: number; reps?: number; seconds?: number }[]) {
		if (ex.type === 'weight') return sets.map((s) => formatSet('weight', s)).join(', ');
		const unit = ex.type === 'time' ? 's' : 'reps';
		return `${sets.map((s) => (ex.type === 'time' ? s.seconds : s.reps)).join(', ')} ${unit}`;
	}
	const volumeText = (v: number) =>
		ex.type === 'weight' ? `${formatNumber(v)} kg` : ex.type === 'time' ? formatSeconds(v) : `${v} reps`;
	const best = $derived(data.points.reduce((b, p) => Math.max(b, p.value), 0));
</script>

<svelte:head><title>{ex.name} · Historik · Milon-PT</title></svelte:head>

<main>
	<p><a href="/historik" class="back">← Historik</a></p>
	<h1>{ex.name}</h1>

	<section class="card">
		<div class="head">
			<span class="label">{data.metric.label}{ex.type === 'weight' ? ' (vikt × (1 + reps/30))' : ''}</span>
			{#if data.points.length}<span class="best">Bästa: {fmt(best)}</span>{/if}
		</div>
		{#if data.points.length > 1}
			<LineChart
				points={data.points}
				label="{data.metric.label} för {ex.name} över tid"
				kind={ex.type === 'time' ? 'seconds' : ex.type === 'bodyweight' ? 'integer' : 'number'}
				format={fmt}
			/>
		{:else if data.points.length === 1}
			<p class="meta">Ett pass hittills: {fmt(data.points[0].value)}. Grafen visas från två pass.</p>
		{:else}
			<p class="meta">Inga loggade set än.</p>
		{/if}
	</section>

	{#if data.entries.length}
		<h2>Senaste passen</h2>
		<div class="card table-wrap">
			<table>
				<thead>
					<tr>
						<th scope="col">Datum</th>
						<th scope="col">Set</th>
						<th scope="col" class="num">Bästa</th>
						<th scope="col" class="num">Volym</th>
					</tr>
				</thead>
				<tbody>
					{#each data.entries as e, i (i)}
						<tr>
							<td>{date(e.date)}</td>
							<td>{setsText(e.sets)}</td>
							<td class="num">
								{e.best === null ? '–' : fmt(e.best)}
								{#if e.record}<span class="record">★ Rekord</span>{/if}
							</td>
							<td class="num">{volumeText(e.volume)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if ex.instruction}
		<details>
			<summary>Instruktion</summary>
			<p class="instruction">{ex.instruction}</p>
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
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 1rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}
	.label,
	.meta {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.best {
		font-weight: 600;
	}
	.table-wrap {
		padding: 0;
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	td:first-child {
		white-space: nowrap;
	}
	th,
	td {
		text-align: left;
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}
	tr:last-child td {
		border-bottom: none;
	}
	th {
		color: var(--muted);
		font-weight: 500;
	}
	.num {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.record {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text);
	}
	details {
		margin-top: 1.25rem;
		color: var(--muted);
	}
	.instruction {
		white-space: pre-line;
		color: var(--text);
	}
</style>
