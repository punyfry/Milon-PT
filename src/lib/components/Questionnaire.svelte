<script lang="ts">
	/**
	 * The questionnaire for describing a new workout to Milon (#102): one question
	 * per view, every question can be skipped, and the answers become the first
	 * message in the builder's input field. The page owns the step (it is in the
	 * URL); answers live here and in sessionStorage, so a reload keeps them.
	 */
	import { deserialize } from '$app/forms';
	import { onMount, tick } from 'svelte';
	import {
		MAX_OTHER,
		OTHER,
		QUESTIONS,
		answerFromFact,
		composeMessage,
		factValue,
		type Answer,
		type Answers,
		type KnownFacts,
		type ProfileFact,
		type Question
	} from '$lib/builder/questionnaire';

	interface Props {
		/** 1-based, at most QUESTIONS.length. */
		step: number;
		known: KnownFacts;
		ongo: (step: number) => void;
		/** Leaves the questionnaire for free text, without a message. */
		oncancel: () => void;
		/** Done: the message to put in the input field. */
		onfinish: (text: string) => void;
	}

	let { step, known, ongo, oncancel, onfinish }: Props = $props();

	const STORE = 'milon-fragor';
	type Saved = { answers: Answers; save: Partial<Record<ProfileFact, boolean>> };

	/** What the profile already says preselects place and experience. */
	function fromProfile(): Answers {
		const answers: Answers = {};
		for (const q of QUESTIONS) {
			const value = q.fact === 'place' ? known.place : q.fact === 'experience' ? known.experience : undefined;
			const answer = answerFromFact(q, value);
			if (answer) answers[q.id] = answer;
		}
		return answers;
	}

	let answers = $state<Answers>(fromProfile());
	let save = $state<Partial<Record<ProfileFact, boolean>>>({});
	let busy = $state(false);
	let failure = $state<string | null>(null);
	let heading: HTMLElement | undefined = $state();

	const question = $derived(QUESTIONS[step - 1]);
	const last = $derived(step === QUESTIONS.length);
	const answer = $derived<Answer>(answers[question.id] ?? { selected: [], other: '' });
	/** The answer to a profile question, and whether the profile already has it. */
	const fact = $derived(question.fact ? factValue(question, answers[question.id]) : undefined);
	const knownValue = $derived(question.fact === 'place' ? known.place : question.fact === 'experience' ? known.experience : undefined);
	const alreadyKnown = $derived(fact !== undefined && (fact === knownValue || (question.fact === 'avoid' && known.rules.includes(fact))));

	onMount(() => {
		try {
			const raw = sessionStorage.getItem(STORE);
			const saved = raw ? (JSON.parse(raw) as Saved) : null;
			if (saved && typeof saved.answers === 'object' && saved.answers) {
				answers = saved.answers;
				save = saved.save ?? {};
			}
		} catch {
			// No storage (private mode): the answers just aren't kept over a reload.
		}
	});

	function remember() {
		try {
			sessionStorage.setItem(STORE, JSON.stringify({ answers, save } satisfies Saved));
		} catch {
			// See onMount.
		}
	}

	function forget() {
		try {
			sessionStorage.removeItem(STORE);
		} catch {
			// See onMount.
		}
	}

	let previous = 0;
	$effect(() => {
		const at = step;
		// The new question takes focus, so a screen reader reads it.
		if (previous && previous !== at) void tick().then(() => heading?.focus());
		previous = at;
	});

	function setAnswer(next: Answer) {
		answers = { ...answers, [question.id]: next };
		remember();
	}

	function toggle(q: Question, value: string, on: boolean) {
		const selected = q.kind === 'checkbox' ? (on ? [...answer.selected, value] : answer.selected.filter((v) => v !== value)) : [value];
		setAnswer({ ...answer, selected });
	}

	function setSave(key: ProfileFact, on: boolean) {
		save = { ...save, [key]: on };
		remember();
	}

	/** Saves the chosen profile answers that Milon doesn't already know. */
	async function saveFacts(): Promise<boolean> {
		const body = new FormData();
		for (const q of QUESTIONS) {
			if (!q.fact || !save[q.fact]) continue;
			const value = factValue(q, answers[q.id]);
			const knownAlready = q.fact === 'avoid' ? value !== undefined && known.rules.includes(value) : value === (q.fact === 'place' ? known.place : known.experience);
			if (value && !knownAlready) body.set(q.fact, value);
		}
		if ([...body.keys()].length === 0) return true;
		try {
			const res = await fetch('?/profile', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			const result = deserialize(await res.text());
			if (result.type === 'success') return true;
			failure = (result.type === 'failure' && (result.data?.error as string | undefined)) || 'Kunde inte spara i profilen. Försök igen.';
		} catch {
			failure = 'Kunde inte nå servern. Kontrollera nätet och försök igen.';
		}
		return false;
	}

	async function next() {
		if (busy) return;
		failure = null;
		if (!last) return ongo(step + 1);
		busy = true;
		const ok = await saveFacts();
		busy = false;
		if (!ok) return;
		const text = composeMessage(answers, known);
		forget();
		onfinish(text);
	}

	function skip() {
		const rest = { ...answers };
		delete rest[question.id];
		answers = rest;
		if (question.fact) save = { ...save, [question.fact]: false };
		remember();
		void next();
	}

	function back() {
		failure = null;
		if (step > 1) ongo(step - 1);
		else oncancel();
	}
</script>

<form class="ask" onsubmit={(e) => (e.preventDefault(), next())}>
	<p class="label">Fråga {step} av {QUESTIONS.length}</p>
	<fieldset>
		<legend><h2 tabindex="-1" bind:this={heading}>{question.title}</h2></legend>
		{#if question.kind === 'text'}
			{#if question.fact === 'avoid' && known.rules.length}
				<div class="known">
					<p class="muted">Milon känner redan till:</p>
					<ul>
						{#each known.rules as rule (rule)}<li>{rule}</li>{/each}
					</ul>
				</div>
			{/if}
			<label class="text">
				<span class="muted">{question.hint}</span>
				<textarea rows="3" maxlength={question.max} value={answer.other} oninput={(e) => setAnswer({ selected: [], other: e.currentTarget.value })}></textarea>
			</label>
		{:else}
			<div class="options">
				{#each question.options as option (option.value)}
					<label class="option">
						<input
							type={question.kind}
							name={question.id}
							value={option.value}
							checked={answer.selected.includes(option.value)}
							onchange={(e) => toggle(question, option.value, e.currentTarget.checked)}
						/>
						<span>{option.label}</span>
					</label>
				{/each}
				<label class="option">
					<input
						type={question.kind}
						name={question.id}
						value={OTHER}
						checked={answer.selected.includes(OTHER)}
						onchange={(e) => toggle(question, OTHER, e.currentTarget.checked)}
					/>
					<span>Annat…</span>
				</label>
				{#if answer.selected.includes(OTHER)}
					<input
						class="other"
						type="text"
						maxlength={MAX_OTHER}
						aria-label="Annat: {question.title}"
						value={answer.other}
						oninput={(e) => setAnswer({ ...answer, other: e.currentTarget.value })}
					/>
				{/if}
			</div>
		{/if}
	</fieldset>

	{#if question.fact && fact}
		{#if alreadyKnown}
			<p class="muted note">Milon vet redan det här från din profil.</p>
		{:else}
			<label class="option save">
				<input type="checkbox" checked={save[question.fact] ?? false} onchange={(e) => setSave(question.fact!, e.currentTarget.checked)} />
				<span>Spara i profilen, så slipper du svara nästa gång</span>
			</label>
		{/if}
	{/if}

	{#if failure}<p class="error" role="alert">{failure}</p>{/if}

	<div class="nav">
		<button type="button" class="btn" onclick={back} disabled={busy}>{step > 1 ? 'Tillbaka' : 'Skriv själv'}</button>
		<button type="button" class="btn ghost" onclick={skip} disabled={busy}>Hoppa över</button>
		<button type="submit" class="btn primary" disabled={busy}>{last ? 'Klart' : 'Nästa'}</button>
	</div>
</form>

<style>
	.ask {
		display: grid;
		gap: 14px;
	}
	.label {
		margin: 0;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
		min-width: 0;
	}
	legend {
		padding: 0;
		margin-bottom: 12px;
	}
	h2 {
		font-size: 20px;
		font-weight: 600;
		color: var(--heading);
	}
	h2:focus {
		outline: none;
	}
	.options {
		display: grid;
		gap: 8px;
	}
	.option {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		padding: 0 14px;
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
	}
	.option input {
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--accent);
		flex: none;
	}
	.option.save {
		background: none;
		padding: 0;
	}
	.other,
	textarea {
		width: 100%;
		min-height: 48px;
		border-radius: var(--radius);
		border: 0;
		background: var(--surface-2);
		padding: 12px 14px;
	}
	textarea {
		resize: vertical;
	}
	.text {
		display: grid;
		gap: 8px;
		font-size: 14px;
	}
	.known p {
		margin: 0;
		font-size: 14px;
	}
	.known ul {
		margin: 4px 0 0;
		padding-left: 20px;
		font-size: 14px;
	}
	.note {
		margin: 0;
		font-size: 14px;
	}
	.nav {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 8px;
	}
	.error {
		margin: 0;
	}
</style>
