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
	/**
	 * Name, type and instruction of an exercise the user writes in. Used when building a workout, swapping and editing.
	 * With `note` bound, the exercise's own note is shown too (the library, #64).
	 */
	import { MAX_EXERCISE_NAME, MAX_INSTRUCTION, NOTE_MAX } from '$lib/model';

	interface Props {
		name: string;
		type: ExerciseType;
		instruction: string;
		note?: string;
		/** Why the type can't change (see `typeLockReason`), or null if it can. */
		typeLock?: string | null;
		/** Prefix for the field ids, so several forms can be on one page. */
		idPrefix?: string;
	}

	let { name = $bindable(), type = $bindable(), instruction = $bindable(), note = $bindable(), typeLock = null, idPrefix = 'ex' }: Props = $props();
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
				<button type="button" aria-pressed={type === key} disabled={!!typeLock && type !== key} onclick={() => (type = key as ExerciseType)}>{label}</button>
			{/each}
		</div>
		<span class="hint">{typeLock ?? TYPE_HINT[type]}</span>
	</div>

	<label class="field">
		<span class="label">Instruktion till dig själv (valfritt)</span>
		<textarea bind:value={instruction} rows="3" maxlength={MAX_INSTRUCTION} placeholder="T.ex. rak rygg, dra armbågen mot höften"></textarea>
	</label>

	{#if note !== undefined}
		<label class="field">
			<span class="label">Anteckning (valfritt)</span>
			<textarea bind:value={note} rows="3" maxlength={NOTE_MAX} placeholder="T.ex. varför den verkar intressant eller vilket pass den kan passa i"></textarea>
		</label>
	{/if}
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
