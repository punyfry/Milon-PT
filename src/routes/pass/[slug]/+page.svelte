<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import SetRow from '$lib/components/SetRow.svelte';
	import { formatNumber, formatSeconds, timeAgo } from '$lib/format';
	import type { ActiveSession } from '$lib/model';
	import {
		addSet,
		adjust,
		anyTimerRunning,
		completeExpiredTimers,
		createActiveSession,
		localIsoString,
		removeSet,
		setField,
		startTimer,
		stopTimer,
		summarize,
		touch,
		type ExerciseInfo,
		type SetField
	} from '$lib/session/active';
	import { beep, unlockAudio } from '$lib/session/beep';
	import { clearActiveSession, loadActiveSession, saveActiveSession } from '$lib/session/storage';
	import { createWakeLock } from '$lib/session/wakelock';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const infos = $derived(new Map<string, ExerciseInfo>(data.exercises.map((e) => [e.id, e])));

	let session = $state<ActiveSession | null>(null);
	/** Ett annat pass pågår redan; visas i stället för att skriva över det. */
	let other = $state<ActiveSession | null>(null);
	let mode = $state<'active' | 'finish'>('active');
	let now = $state(new Date());
	let storageWarning = $state(false);

	// Avslutsvyn
	let kcal = $state(0);
	let saveAsNewVersion = $state(false);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	onMount(() => {
		kcal = data.kcalSuggestion;
		const stored = loadActiveSession();
		if (stored && stored.workoutSlug !== data.workout.slug) {
			other = stored;
			return;
		}
		if (stored) {
			// Rätt version och alla inbytta övningar måste vara laddade.
			const missing = stored.exercises.map((e) => e.exerciseId).filter((id) => !infos.has(id));
			if (stored.workoutVersion !== data.workout.version || missing.length) {
				const params = new URLSearchParams({ v: String(stored.workoutVersion) });
				if (missing.length) params.set('ex', missing.join(','));
				const target = `/pass/${stored.workoutSlug}?${params}`;
				if (target !== page.url.pathname + page.url.search) {
					void goto(target, { replaceState: true });
					return;
				}
			}
			session = stored;
		} else {
			session = createActiveSession(data.workout, infos, new Date());
			persist();
		}
		if (completeExpiredTimers(session, new Date())) persist();
	});

	function persist() {
		if (!session) return;
		touch(session, new Date());
		storageWarning = !saveActiveSession($state.snapshot(session));
	}

	/** Kör en ändring och sparar direkt till localStorage. */
	function change(fn: (s: ActiveSession) => void) {
		if (!session) return;
		fn(session);
		persist();
	}

	// Timer: räkna ner, fyll i tiden vid noll och håll skärmen tänd.
	const timerRunning = $derived(session ? anyTimerRunning(session) : false);
	onMount(() => {
		const wakeLock = createWakeLock();
		const tick = setInterval(() => {
			now = new Date();
			if (session && anyTimerRunning(session) && completeExpiredTimers(session, now)) {
				beep();
				persist();
			}
		}, 250);
		const stopWatching = $effect.root(() => {
			$effect(() => wakeLock.set(timerRunning));
		});
		return () => {
			clearInterval(tick);
			stopWatching();
			wakeLock.destroy();
		};
	});

	function onAdjust(exIndex: number, setIndex: number, field: SetField, dir: 1 | -1) {
		const loadClass = infos.get(session!.exercises[exIndex].exerciseId)?.loadClass;
		change((s) => adjust(s.exercises[exIndex].sets[setIndex], field, dir, loadClass));
	}

	function startFinish() {
		change((s) => {
			for (const ex of s.exercises) for (const set of ex.sets) stopTimer(set, new Date());
		});
		saveError = null;
		mode = 'finish';
		scrollTo(0, 0);
	}

	const summary = $derived(session && mode === 'finish' ? summarize(session, infos) : null);

	async function save() {
		if (!session) return;
		saving = true;
		saveError = null;
		try {
			const res = await fetch('/api/sessions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					session: $state.snapshot(session),
					endedAt: localIsoString(new Date()),
					kcalEstimate: Number.isFinite(kcal) && kcal >= 0 ? kcal : undefined,
					saveAsNewVersion: session.deviations.length > 0 && saveAsNewVersion
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Servern svarade ${res.status}`);
			}
			// Först när servern bekräftat rensas det lokala passet.
			clearActiveSession();
			await goto('/', { invalidateAll: true });
		} catch (e) {
			saveError = `${e instanceof Error ? e.message : 'Okänt fel'}. Passet ligger kvar lokalt, försök igen.`;
		} finally {
			saving = false;
		}
	}

	function abort() {
		if (!confirm('Avbryta passet? Inget av det loggas.')) return;
		clearActiveSession();
		void goto('/');
	}

	const unitFor = { weight: 'kg', bodyweight: 'reps', time: '' } as const;
	function formatVolume(type: 'weight' | 'bodyweight' | 'time', v: number) {
		return type === 'time' ? formatSeconds(v) : `${formatNumber(v)} ${unitFor[type]}`;
	}
</script>

<svelte:head><title>{data.workout.name} · Milon-PT</title></svelte:head>

<main>
	{#if other}
		<p><a href="/">← Tillbaka</a></p>
		<h1>Ett annat pass pågår</h1>
		<p>Du har redan ett pågående pass. Fortsätt det eller avbryt det från startsidan.</p>
		<p><a href={`/pass/${other.workoutSlug}?v=${other.workoutVersion}`}>Fortsätt pågående pass</a></p>
	{:else if session && mode === 'active'}
		<header>
			<a href="/" class="back">← Start</a>
			<h1>{data.workout.name}</h1>
			<span class="meta">Startade {timeAgo(session.startedAt, now)}</span>
		</header>

		{#if storageWarning}
			<p class="warning">Kunde inte spara lokalt i webbläsaren. Stäng inte sidan innan passet är sparat.</p>
		{/if}

		{#each session.exercises as ex, exIndex (ex.exerciseId + exIndex)}
			{@const info = infos.get(ex.exerciseId)}
			<section class="exercise">
				<h2>{info?.name ?? ex.exerciseId}</h2>
				{#if info?.instruction}
					<details>
						<summary>Instruktion</summary>
						<p class="instruction">{info.instruction}</p>
					</details>
				{/if}
				{#if info}
					{#each ex.sets as set, setIndex (setIndex)}
						<SetRow
							{set}
							type={info.type}
							index={setIndex}
							{now}
							onadjust={(field, dir) => onAdjust(exIndex, setIndex, field, dir)}
							onset={(field, value) => change((s) => setField(s.exercises[exIndex].sets[setIndex], field, value))}
							ontoggle={() => change((s) => (s.exercises[exIndex].sets[setIndex].done = !s.exercises[exIndex].sets[setIndex].done))}
							onremove={() => change((s) => removeSet(s.exercises[exIndex].sets, setIndex))}
							onstarttimer={() => {
								unlockAudio();
								change((s) => startTimer(s.exercises[exIndex].sets[setIndex], new Date()));
							}}
							onstoptimer={() => change((s) => stopTimer(s.exercises[exIndex].sets[setIndex], new Date()))}
						/>
					{/each}
					<button class="add" onclick={() => change((s) => addSet(s.exercises[exIndex].sets, info.type))}>+ Lägg till set</button>
				{:else}
					<p class="warning">Övningen {ex.exerciseId} finns inte längre.</p>
				{/if}
			</section>
		{/each}

		<div class="actions">
			<button class="primary" onclick={startFinish}>Avsluta pass</button>
			<button class="link danger" onclick={abort}>Avbryt pass</button>
		</div>
	{:else if session && summary}
		<header>
			<button class="link back" onclick={() => (mode = 'active')}>← Tillbaka till passet</button>
			<h1>Avsluta {data.workout.name}</h1>
		</header>

		<section class="summary">
			<h2>Sammanfattning</h2>
			<ul>
				{#each summary.exercises as ex (ex.exerciseId)}
					<li class:skipped={ex.doneSets === 0}>
						<span>{ex.name}</span>
						<span class="meta">
							{ex.doneSets}/{ex.totalSets} set
							{#if ex.doneSets > 0}· {formatVolume(ex.type, ex.volume)}{/if}
						</span>
					</li>
				{/each}
			</ul>
			<p class="totals">
				Total volym:
				{#each (['weight', 'bodyweight', 'time'] as const).filter((t) => summary.volumeByType[t] > 0) as t, i (t)}
					{i > 0 ? ' · ' : ''}{formatVolume(t, summary.volumeByType[t])}
				{:else}
					–
				{/each}
			</p>
		</section>

		{#if session.deviations.length}
			<fieldset>
				<legend>Spara ändringarna som ny version av passet?</legend>
				<label><input type="radio" bind:group={saveAsNewVersion} value={true} /> Ja, skapa nästa version</label>
				<label><input type="radio" bind:group={saveAsNewVersion} value={false} /> Nej, lämna passet som det är</label>
			</fieldset>
		{/if}

		<label class="kcal">
			Uppskattad förbränning
			<span>
				<input type="number" inputmode="numeric" min="0" step="10" bind:value={kcal} /> kcal
			</span>
		</label>

		{#if saveError}<p class="warning" role="alert">{saveError}</p>{/if}
		{#if summary.doneSets === 0}
			<p class="warning">Inga set är markerade som klara, så det finns inget att spara.</p>
		{/if}

		<div class="actions">
			<button class="primary" onclick={save} disabled={saving || summary.doneSets === 0}>
				{saving ? 'Sparar…' : 'Spara'}
			</button>
		</div>
	{/if}
</main>

<style>
	header {
		margin-bottom: 1rem;
	}
	header h1 {
		margin: 0.25rem 0 0;
	}
	.back {
		color: var(--muted);
		text-decoration: none;
		padding-left: 0;
	}
	.meta {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.exercise {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 0.75rem;
		margin-bottom: 1rem;
	}
	.exercise h2 {
		font-size: 1.15rem;
		margin: 0 0 0.25rem 0.25rem;
	}
	details {
		margin: 0 0.25rem 0.5rem;
		color: var(--muted);
	}
	summary {
		cursor: pointer;
		font-size: 0.9rem;
	}
	.instruction {
		white-space: pre-line;
		color: var(--text);
		margin: 0.5rem 0;
	}
	.add {
		margin: 0.5rem 0.25rem 0;
		background: none;
		border: 1px dashed var(--border);
		border-radius: 10px;
		padding: 0.5rem 0.9rem;
		color: var(--muted);
		cursor: pointer;
	}
	.actions {
		display: grid;
		gap: 0.75rem;
		margin-top: 1.5rem;
		justify-items: center;
	}
	.primary {
		width: 100%;
		padding: 1rem;
		border-radius: var(--radius);
		border: none;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 1.1rem;
		font-weight: 600;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.warning {
		color: var(--danger);
	}
	.summary ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.summary li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border);
	}
	.summary li.skipped {
		color: var(--muted);
	}
	.totals {
		font-weight: 600;
	}
	fieldset {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.75rem 1rem;
		margin: 1rem 0;
		display: grid;
		gap: 0.5rem;
	}
	.kcal {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}
	.kcal input {
		width: 5.5rem;
		padding: 0.5rem;
		font: inherit;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		text-align: right;
	}
</style>
