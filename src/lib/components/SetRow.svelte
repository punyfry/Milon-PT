<script lang="ts">
	/**
	 * One row in the set list. The active set is large, with free text for
	 * weight and −/+ for reps and time; done and upcoming sets are muted rows
	 * that can be tapped to edit (DESIGN.md).
	 */
	import { formatNumber, formatSeconds } from '$lib/format';
	import type { ActiveSet, ExerciseType } from '$lib/model';
	import { isTimerRunning, remainingMs, timerStartSeconds, type SetField } from '$lib/session/active';
	import Icon from './Icon.svelte';

	interface Props {
		set: ActiveSet;
		type: ExerciseType;
		index: number;
		/** Last session's value for the same set, e.g. "70×8". */
		previous: string;
		active: boolean;
		record: boolean;
		now: Date;
		onfocus: () => void;
		oncheck: () => void;
		onstep: (field: SetField, delta: number) => void;
		onset: (field: SetField, value: number) => void;
		onremove: () => void;
		onstarttimer: () => void;
		onstoptimer: () => void;
	}

	let { set, type, index, previous, active, record, now, onfocus, oncheck, onstep, onset, onremove, onstarttimer, onstoptimer }: Props =
		$props();

	const values = $derived(set as unknown as Partial<Record<SetField, number>>);
	const running = $derived(isTimerRunning(set));
	const one = $derived(type !== 'weight');
	const n = $derived(index + 1);

	function text(): string {
		if (type === 'weight') return `${formatNumber(values.weight ?? 0)} kg × ${values.reps ?? 0}`;
		if (type === 'time') return formatSeconds(values.seconds ?? 0);
		return `${values.reps ?? 0} reps`;
	}

	function onWeight(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = input.value.replace(',', '.').trim();
		// Plain decimals only: Number() would also accept "1e3" or "0x10".
		if (/^\d{1,4}(\.\d{1,2})?$/.test(raw)) onset('weight', Number(raw));
		// Show the value that actually applies (invalid input is ignored).
		input.value = formatNumber(values.weight ?? 0);
	}
</script>

{#if active}
	<div class="active" role="group" aria-label="Set {n}, aktivt">
		<div class="grid top" class:one>
			<span class="small num">{n}</span>
			<span class="small num">{previous}</span>
			{#if type === 'weight'}
				<label class="big num">
					<span class="sr-only">Vikt i kg, set {n}</span>
					<input
						class="num"
						type="text"
						inputmode="decimal"
						enterkeyhint="done"
						value={formatNumber(values.weight ?? 0)}
						onfocus={(e) => e.currentTarget.select()}
						onchange={onWeight}
						onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					/><small>kg</small>
				</label>
				<span class="big num">{values.reps ?? 0}<small>reps</small></span>
			{:else if type === 'bodyweight'}
				<span class="big num">{values.reps ?? 0}<small>reps</small></span>
			{:else}
				<span class="big num" class:ticking={running}>
					{formatSeconds(running ? Math.ceil(remainingMs(set, now) / 1000) : (values.seconds ?? 0))}
				</span>
			{/if}
			<button type="button" class="checkbtn" onclick={oncheck} aria-pressed={set.done} aria-label="{set.done ? 'Ta bort klarmarkering för' : 'Klarmarkera'} set {n}">
				<Icon name="check" stroke={2.25} />
			</button>
		</div>
		{#if record}<div class="grid" class:one><span></span><span></span><span><span class="tag glow">PR</span></span></div>{/if}
		<div class="controls">
			{#if running}
				<span class="muted hint">Räknar ner…</span>
			{:else}
				<button type="button" class="link" onclick={onremove}>Ta bort set</button>
			{/if}
			<span class="steps">
				{#if type === 'time'}
					{#if !running}
						<button type="button" class="step wide num" onclick={() => onstep('seconds', -5)} aria-label="Minska tid 5 sekunder">−5</button>
						<button type="button" class="step wide num" onclick={() => onstep('seconds', 5)} aria-label="Öka tid 5 sekunder">+5</button>
					{/if}
					<button type="button" class="timerbtn" class:stop={running} onclick={running ? onstoptimer : onstarttimer} disabled={!running && timerStartSeconds(set) <= 0}>
						{running ? 'Stopp' : 'Starta'}
					</button>
				{:else}
					<button type="button" class="step" onclick={() => onstep('reps', -1)} aria-label="Minska reps">−</button>
					<button type="button" class="step" onclick={() => onstep('reps', 1)} aria-label="Öka reps">+</button>
				{/if}
			</span>
		</div>
	</div>
{:else}
	<button type="button" class="row grid" class:one class:done={set.done} onclick={onfocus} aria-label="Set {n}, {set.done ? 'klart' : 'kommande'}: {text()}. Tryck för att ändra.">
		<span class="small num">{n}</span>
		<span class="small num">{previous}</span>
		{#if type === 'weight'}
			<span class="v num">{formatNumber(values.weight ?? 0)}{#if record}<span class="tag">PR</span>{/if}</span>
			<span class="v num">{values.reps ?? 0}</span>
		{:else}
			<span class="v num">{type === 'time' ? formatSeconds(values.seconds ?? 0) : (values.reps ?? 0)}{#if record}<span class="tag">PR</span>{/if}</span>
		{/if}
		<span class="mark">
			{#if set.done}<Icon name="check" stroke={2.25} />{:else}<span class="ring"></span>{/if}
		</span>
	</button>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: 28px 64px 1fr 1fr 44px;
		gap: 8px;
		align-items: center;
	}
	.grid.one {
		grid-template-columns: 28px 64px 1fr 44px;
	}
	.small {
		font-size: 13px;
		color: var(--muted);
	}
	.row {
		width: 100%;
		min-height: 56px;
		padding: 0;
		background: none;
		border: 0;
		border-bottom: 1px solid var(--line);
		text-align: left;
		cursor: pointer;
	}
	.v {
		font-size: 20px;
		font-weight: 400;
		color: var(--dim);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.done .v {
		color: var(--text);
		font-weight: 500;
	}
	.mark {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		color: var(--accent);
	}
	.ring {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1.5px solid var(--ring);
	}
	.active {
		background: var(--active-set);
		border-radius: 6px;
		padding: 6px 8px 8px;
		margin: 6px -8px;
	}
	.active .top {
		min-height: 60px;
	}
	.big {
		font-size: 34px;
		font-weight: 500;
		letter-spacing: -0.04em;
		color: var(--accent);
		line-height: 1;
		display: flex;
		align-items: baseline;
		gap: 4px;
		min-width: 0;
	}
	.big small {
		font-family: var(--mono);
		font-size: 13px;
		letter-spacing: 0;
		color: var(--muted);
		font-weight: 400;
	}
	.big input {
		width: 100%;
		min-width: 0;
		background: none;
		border: 0;
		border-bottom: 1.5px dashed var(--ring);
		padding: 0 0 2px;
		font: inherit;
		color: inherit;
		letter-spacing: inherit;
	}
	.big input:focus {
		outline: none;
		border-bottom-color: var(--accent);
	}
	.checkbtn {
		width: 44px;
		height: 44px;
		border-radius: 14px;
		border: 0;
		background: var(--accent);
		color: var(--on-accent);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.controls {
		margin-top: 4px;
		padding-left: 100px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.hint {
		font-size: 13px;
	}
	.steps {
		display: flex;
		gap: 3px;
		align-items: center;
	}
	.step {
		width: 44px;
		height: 44px;
		border-radius: 14px;
		border: 0;
		background: var(--step);
		color: var(--text);
		font-family: var(--mono);
		font-size: 18px;
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.step.wide {
		width: auto;
		padding: 0 12px;
		font-size: 13px;
	}
	.step:active,
	.checkbtn:active {
		transform: scale(0.96);
	}
	.timerbtn {
		min-height: 44px;
		border-radius: 14px;
		border: 0;
		padding: 0 16px;
		font-weight: 500;
		font-size: 14px;
		background: var(--accent);
		color: var(--on-accent);
		cursor: pointer;
	}
	.timerbtn.stop {
		background: var(--text);
		color: var(--bg);
	}
	.timerbtn:disabled {
		opacity: 0.4;
	}
	.glow {
		animation: glow 1.2s ease-out 1;
	}
	@keyframes glow {
		from {
			box-shadow: 0 0 0 0 var(--accent);
		}
		to {
			box-shadow: 0 0 0 10px transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.glow {
			animation: none;
		}
	}
</style>
