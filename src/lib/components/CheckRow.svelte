<script lang="ts">
	/**
	 * A set in a warm-up or stretch exercise (#100): the target, a timer for a
	 * timed exercise and a "Klar" button. No −/+ and no weights: these sets are
	 * ticked off, not adjusted.
	 */
	import { formatSeconds } from '$lib/format';
	import type { ActiveSet, ExerciseType } from '$lib/model';
	import { isTimerRunning, remainingMs, timerStartSeconds } from '$lib/session/active';
	import Icon from './Icon.svelte';

	interface Props {
		set: ActiveSet;
		type: ExerciseType;
		/** Name of the exercise and set, for screen readers, e.g. "Höftböjarstretch, set 2". */
		label: string;
		/** Shown before the value when the exercise has more than one set. */
		number: number | null;
		now: Date;
		oncheck: () => void;
		onstarttimer: () => void;
		onstoptimer: () => void;
	}

	let { set, type, label, number, now, oncheck, onstarttimer, onstoptimer }: Props = $props();

	const running = $derived(isTimerRunning(set));
	const value = $derived(
		'seconds' in set
			? formatSeconds(running ? Math.ceil(remainingMs(set, now) / 1000) : set.seconds)
			: 'reps' in set
				? `${set.reps} reps`
				: ''
	);
</script>

<div class="check" class:done={set.done}>
	{#if number !== null}<span class="n num">{number}</span>{/if}
	<span class="value num" class:ticking={running}>{value}</span>
	{#if type === 'time'}
		<button
			type="button"
			class="btn small timer"
			class:stop={running}
			onclick={running ? onstoptimer : onstarttimer}
			disabled={!running && timerStartSeconds(set) <= 0}
			aria-label="{running ? 'Stoppa timern för' : 'Starta timern för'} {label}">{running ? 'Stopp' : 'Starta'}</button
		>
	{/if}
	<button type="button" class="btn small klar" aria-pressed={set.done} onclick={oncheck} aria-label="Klar: {label}">
		{#if set.done}<Icon name="check" stroke={2.25} />{/if} Klar
	</button>
</div>

<style>
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 56px;
		border-bottom: 1px solid var(--line);
	}
	.n {
		width: 20px;
		font-size: 13px;
		color: var(--muted);
	}
	.value {
		flex: 1;
		font-size: 20px;
		color: var(--dim);
	}
	.done .value,
	.value.ticking {
		color: var(--text);
		font-weight: 500;
	}
	.timer.stop {
		background: var(--text);
		color: var(--bg);
	}
	.klar[aria-pressed='true'] {
		background: var(--accent);
		color: var(--on-accent);
	}
</style>
