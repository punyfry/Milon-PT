<script lang="ts">
	/**
	 * Picks an exercise to swap to, from the user's own exercises. Used in the
	 * overview before a workout and during it. A new exercise can be written
	 * in (`onnew`), and Milon can suggest variants or new exercises (`onaskmilon`).
	 */
	import { formatSet } from '$lib/format';
	import { Issues, MAX_NEW_EXERCISES, findSameExercise, issueText, validateExerciseInput, type ActiveSession, type ExerciseType, type NewSessionExercise } from '$lib/model';
	import { swapCandidates, type ExerciseInfo } from '$lib/session/active';
	import ExerciseFields, { TYPE_LABEL } from './ExerciseFields.svelte';
	import Icon from './Icon.svelte';
	import MilonAvatar from './MilonAvatar.svelte';

	interface Props {
		/** The exercise being swapped out. */
		name: string;
		type: ExerciseType | undefined;
		catalog: readonly ExerciseInfo[];
		session: ActiveSession;
		/** Shown when the helper is available. */
		onaskmilon?: () => void;
		onpick: (to: ExerciseInfo) => void;
		/** A new exercise written in; it is created when the workout is saved. */
		onnew: (exercise: Omit<NewSessionExercise, 'id'>) => void;
		onclose: () => void;
	}

	let { name, type, catalog, session, onaskmilon, onpick, onnew, onclose }: Props = $props();
	let query = $state('');
	const candidates = $derived(swapCandidates(catalog, session, type, query));

	// --- writing in a new exercise --------------------------------------------
	let writing = $state(false);
	let fresh = $state({ name: '', type: 'weight' as ExerciseType, instruction: '' });
	let newError = $state<string | null>(null);

	function startWriting() {
		fresh = { name: query.trim(), type: type ?? 'weight', instruction: '' };
		newError = null;
		writing = true;
	}

	function addNew(e: SubmitEvent) {
		e.preventDefault();
		const issues = new Issues();
		const input = validateExerciseInput(fresh, issues, '');
		if (!input) return void (newError = issueText(issues.list[0] ?? 'Kontrollera övningen'));
		const inSession = new Set(session.exercises.map((x) => x.exerciseId));
		const known = findSameExercise([...catalog, ...(session.newExercises ?? [])], input);
		if (known && inSession.has(known.id)) return void (newError = `${known.name} finns redan i passet.`);
		// The same exercise already exists: swap to it rather than creating a copy.
		const existing = catalog.find((c) => c.id === known?.id);
		if (existing) return onpick(existing);
		const live = (session.newExercises ?? []).filter((n) => inSession.has(n.id));
		if (live.length >= MAX_NEW_EXERCISES) return void (newError = `Högst ${MAX_NEW_EXERCISES} nya övningar per pass.`);
		onnew(input);
	}

	function last(e: ExerciseInfo): string | null {
		const s = e.lastEntry?.sets[0];
		return s ? `förra ${formatSet(e.type, s)}` : null;
	}
</script>

<div class="head">
	<h2>Byt {name}</h2>
	<button type="button" class="icon-btn" onclick={onclose} aria-label="Stäng"><Icon name="x" /></button>
</div>
<p class="muted intro">Bytet gäller bara det här passet. När du avslutar kan du välja att spara det i passet.</p>

{#if writing}
	<form class="new" onsubmit={addNew}>
		<ExerciseFields bind:name={fresh.name} bind:type={fresh.type} bind:instruction={fresh.instruction} idPrefix="swap-new" />
		<p class="muted small">Övningen sparas när du sparar passet.</p>
		{#if newError}<p class="error" role="alert">{newError}</p>{/if}
		<button type="submit" class="btn primary full">Byt till {fresh.name.trim() || 'den nya övningen'}</button>
		<button type="button" class="btn ghost full" onclick={() => (writing = false)}>Tillbaka till listan</button>
	</form>
{:else}
{#if onaskmilon}
	<button type="button" class="btn full" onclick={onaskmilon}><MilonAvatar size={20} tight /> Fråga Milon om varianter eller nya övningar</button>
{/if}

<input type="search" bind:value={query} placeholder="Sök bland dina övningar" aria-label="Sök övning" enterkeyhint="search" />

{#if candidates.length}
	<ul class="list">
		{#each candidates as c (c.id)}
			{@const meta = last(c)}
			<li>
				<button type="button" class="row" onclick={() => onpick(c)}>
					<span class="name">{c.name}</span>
					<span class="meta">
						{#if c.type !== type}{TYPE_LABEL[c.type]}{/if}{#if c.type !== type && meta}&nbsp;·&nbsp;{/if}{#if meta}<span class="num">{meta}</span>{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>
{:else}
	<p class="muted">{query.trim() ? `Ingen övning matchar "${query.trim()}".` : 'Alla dina övningar finns redan i passet.'}</p>
{/if}

<button type="button" class="btn full" onclick={startWriting}><Icon name="plus" /> Skriv in en ny övning</button>
{/if}

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h2 {
		font-size: 20px;
		font-weight: 600;
	}
	.intro {
		font-size: 14px;
	}
	.new {
		display: grid;
		gap: 12px;
	}
	.small {
		font-size: 13px;
		margin: 0;
	}
	input[type='search'] {
		width: 100%;
		min-height: 48px;
		padding: 0 14px;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}
	.row {
		width: 100%;
		min-height: 56px;
		display: grid;
		gap: 2px;
		text-align: left;
		padding: 8px 2px;
		background: none;
		border: 0;
		border-bottom: 1px solid var(--line);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.name {
		font-weight: 500;
	}
	.meta {
		font-size: 13px;
		color: var(--muted);
	}
</style>
