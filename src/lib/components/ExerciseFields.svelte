<script lang="ts" module>
	import type { ExerciseType } from '$lib/model';

	export const TYPE_LABEL: Record<ExerciseType, string> = { weight: 'Vikt', bodyweight: 'Kroppsvikt', time: 'Tid' };
	export const TYPE_HINT: Record<ExerciseType, string> = {
		weight: 'Vikt och reps',
		bodyweight: 'Bara reps',
		time: 'Sekunder, med timer'
	};
</script>

<script lang="ts">
	/** Name, type and instruction of an exercise the user writes in. Used when building a workout, swapping and editing. */
	import { MAX_EXERCISE_NAME, MAX_INSTRUCTION } from '$lib/model';

	interface Props {
		name: string;
		type: ExerciseType;
		instruction: string;
		/** The type can't change once sets are logged, since sets are stored per type. */
		typeLocked?: boolean;
		/** Prefix for the field ids, so several forms can be on one page. */
		idPrefix?: string;
	}

	let { name = $bindable(), type = $bindable(), instruction = $bindable(), typeLocked = false, idPrefix = 'ex' }: Props = $props();
</script>

<div class="fields">
	<label class="field">
		<span class="label">Namn</span>
		<input id="{idPrefix}-name" bind:value={name} maxlength={MAX_EXERCISE_NAME} placeholder="T.ex. Hantelrodd" autocomplete="off" required />
	</label>

	<div class="field">
		<span class="label" id="{idPrefix}-type">Typ</span>
		<div class="seg" role="group" aria-labelledby="{idPrefix}-type">
			{#each Object.entries(TYPE_LABEL) as [key, label] (key)}
				<button type="button" aria-pressed={type === key} disabled={typeLocked && type !== key} onclick={() => (type = key as ExerciseType)}>{label}</button>
			{/each}
		</div>
		<span class="hint">{typeLocked ? 'Typen går inte att ändra när det finns loggade set.' : TYPE_HINT[type]}</span>
	</div>

	<label class="field">
		<span class="label">Instruktion till dig själv (valfritt)</span>
		<textarea bind:value={instruction} rows="3" maxlength={MAX_INSTRUCTION} placeholder="T.ex. rak rygg, dra armbågen mot höften"></textarea>
	</label>
</div>

<style>
	.fields {
		display: grid;
		gap: 14px;
	}
	.field {
		display: grid;
		gap: 6px;
	}
	input,
	textarea {
		width: 100%;
		padding: 12px 14px;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
	}
	input {
		min-height: 48px;
	}
	textarea {
		resize: vertical;
	}
	.seg {
		display: flex;
		background: var(--surface-2);
		border-radius: 14px;
		padding: 3px;
		gap: 3px;
	}
	.seg button {
		flex: 1;
		min-height: 40px;
		border: 0;
		background: none;
		border-radius: 11px;
		font-size: 14px;
		font-weight: 500;
		color: var(--soft);
		cursor: pointer;
	}
	.seg button[aria-pressed='true'] {
		background: var(--bg);
		color: var(--text);
	}
	.seg button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.hint {
		font-size: 13px;
		color: var(--muted);
	}
</style>
