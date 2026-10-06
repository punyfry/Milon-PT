<script lang="ts">
	import { formatNumber, formatSeconds } from '$lib/format';
	import type { ActiveSet, ExerciseType } from '$lib/model';
	import { isTimerRunning, remainingMs, type SetField } from '$lib/session/active';

	interface Props {
		set: ActiveSet;
		type: ExerciseType;
		index: number;
		now: Date;
		onadjust: (field: SetField, direction: 1 | -1) => void;
		onset: (field: SetField, value: number) => void;
		ontoggle: () => void;
		onremove: () => void;
		onstarttimer: () => void;
		onstoptimer: () => void;
	}

	let { set, type, index, now, onadjust, onset, ontoggle, onremove, onstarttimer, onstoptimer }: Props = $props();

	const values = $derived(set as unknown as Partial<Record<SetField, number>>);
	const fields = $derived<{ field: SetField; label: string; unit: string }[]>(
		type === 'weight'
			? [
					{ field: 'weight', label: 'Vikt', unit: 'kg' },
					{ field: 'reps', label: 'Reps', unit: 'reps' }
				]
			: type === 'bodyweight'
				? [{ field: 'reps', label: 'Reps', unit: 'reps' }]
				: [{ field: 'seconds', label: 'Tid', unit: 's' }]
	);
	const running = $derived(isTimerRunning(set));

	function display(field: SetField): string {
		const v = values[field] ?? 0;
		return field === 'seconds' ? String(v) : formatNumber(v);
	}

	function onInput(field: SetField, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = input.value.replace(',', '.').trim();
		const value = Number(raw);
		if (raw !== '' && Number.isFinite(value)) onset(field, value);
		// Visa det värde som faktiskt gäller (ogiltiga värden ignoreras).
		input.value = display(field);
	}
</script>

<div class="row" class:done={set.done}>
	<span class="num">{index + 1}</span>

	<div class="fields">
		{#each fields as f (f.field)}
			<div class="stepper" role="group" aria-label={f.label}>
				<button type="button" onclick={() => onadjust(f.field, -1)} aria-label="Minska {f.label.toLowerCase()}" disabled={running}>−</button>
				{#if f.field === 'seconds' && running}
					<output class="value timer">{formatSeconds(remainingMs(set, now) / 1000)}</output>
				{:else}
					<input
						class="value"
						type="text"
						inputmode="decimal"
						aria-label={f.label}
						value={display(f.field)}
						onchange={(e) => onInput(f.field, e)}
					/>
				{/if}
				<button type="button" onclick={() => onadjust(f.field, 1)} aria-label="Öka {f.label.toLowerCase()}" disabled={running}>+</button>
				{#if f.unit}<span class="unit">{f.unit}</span>{/if}
			</div>
		{/each}

		{#if type === 'time'}
			{#if running}
				<button type="button" class="timer-btn stop" onclick={onstoptimer}>Stopp</button>
			{:else}
				<button type="button" class="timer-btn" onclick={onstarttimer} disabled={!('seconds' in set) || set.seconds <= 0}>Start</button>
			{/if}
		{/if}
	</div>

	<button type="button" class="check" class:on={set.done} onclick={ontoggle} aria-pressed={set.done} aria-label="Set {index + 1} klart" disabled={running}>✓</button>
	<button type="button" class="remove" onclick={onremove} aria-label="Ta bort set {index + 1}" disabled={running}>×</button>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 1.5rem 1fr auto auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.25rem;
		border-radius: 10px;
	}
	.row.done {
		background: var(--done);
	}
	.num {
		color: var(--muted);
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.stepper button,
	.check,
	.remove,
	.timer-btn {
		min-width: 2.5rem;
		height: 2.5rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 1.1rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.value {
		width: 3.6rem;
		height: 2.5rem;
		text-align: center;
		font-size: 1.1rem;
		font-variant-numeric: tabular-nums;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg);
		color: var(--text);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.timer {
		font-weight: 600;
		color: var(--accent);
	}
	.unit {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.timer-btn {
		padding: 0 0.9rem;
		font-size: 1rem;
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.timer-btn.stop {
		background: var(--danger);
		border-color: var(--danger);
	}
	.check.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.remove {
		border-color: transparent;
		background: none;
		color: var(--muted);
		min-width: 2rem;
	}
</style>
