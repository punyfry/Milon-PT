<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import HelpPanel, { swapQuestion } from '$lib/components/HelpPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import MilonAvatar from '$lib/components/MilonAvatar.svelte';
	import SetRow from '$lib/components/SetRow.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import SwapPicker from '$lib/components/SwapPicker.svelte';
	import { formatNumber, formatSeconds } from '$lib/format';
	import { bestSet, heaviestWeight } from '$lib/history/stats';
	import { NOTE_MAX, findSameExercise, newExerciseId, type ActiveSession, type ActiveSet, type ExerciseType, type NewSessionExercise } from '$lib/model';
	import {
		addSet,
		applySwap,
		anyTimerRunning,
		cancelTimer,
		remainingMs,
		completeExpiredTimers,
		createActiveSession,
		isTimerRunning,
		localIsoString,
		removeSet,
		setField,
		startPreparedSession,
		startTimer,
		stopTimer,
		touch,
		type ExerciseInfo,
		type SetField
	} from '$lib/session/active';
	import { beep, unlockAudio } from '$lib/session/beep';
	import { isNetworkError, pendingKey, queueSave } from '$lib/session/outbox';
	import { clearActiveSession, loadActiveSession, saveActiveSession } from '$lib/session/storage';
	import { createWakeLock } from '$lib/session/wakelock';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Exercises swapped in (by Milon) that were not in the page data, e.g. newly created ones. */
	let swappedIn = $state<ExerciseInfo[]>([]);

	let session = $state<ActiveSession | null>(null);
	/** Exercises written in during the session only exist in it until it is saved. */
	const written = (s: ActiveSession | null): ExerciseInfo[] =>
		(s?.newExercises ?? []).map(({ id, name, type, instruction }) => ({ id, name, type, instruction }));
	const infos = $derived(
		new Map<string, ExerciseInfo>([...data.catalog, ...data.exercises, ...swappedIn, ...written(session)].map((e) => [e.id, e]))
	);
	/** Another workout is already in progress; shown instead of overwriting it. */
	let other = $state<ActiveSession | null>(null);
	let mode = $state<'active' | 'finish'>('active');
	let now = $state(new Date());
	let storageWarning = $state(false);
	/** Active set per exercise (by index in the workout). Missing = first set not done. */
	let focus = $state<Record<number, number>>({});
	let showInstruction = $state<Record<string, boolean>>({});
	let slide = $state<'' | 'in-left' | 'in-right'>('');

	type SheetState =
		| { kind: 'timer'; then: () => void }
		| { kind: 'close' }
		| { kind: 'discard' }
		| { kind: 'help'; exerciseId: string }
		| { kind: 'swap'; exerciseId: string }
		| { kind: 'note'; index: number; text: string };
	let sheet = $state<SheetState | null>(null);
	let undo = $state<{ text: string; run: () => void } | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;

	// Finish view
	let kcal = $state(0);
	let saveAsNewVersion = $state(false);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	onMount(() => {
		kcal = data.kcalSuggestion;
		let stored = loadActiveSession();
		if (stored && stored.workoutSlug !== data.workout.slug) {
			// A workout that is only prepared gives way; one in progress is kept.
			if (!stored.preparing) {
				other = stored;
				return;
			}
			stored = null;
		}
		// A preparation without swaps is rebuilt, so it follows a newer version of the workout.
		if (stored?.preparing && !stored.deviations.length && stored.workoutVersion !== data.workout.version) stored = null;
		if (stored) {
			// The right version and every swapped-in exercise must be loaded.
			const local = new Set(written(stored).map((e) => e.id));
			const missing = stored.exercises.map((e) => e.exerciseId).filter((id) => !infos.has(id) && !local.has(id));
			if (stored.workoutVersion !== data.workout.version || missing.length) {
				const params = new URLSearchParams({ v: String(stored.workoutVersion) });
				if (missing.length) params.set('ex', missing.join(','));
				const target = `/pass/${stored.workoutSlug}?${params}`;
				if (target !== page.url.pathname + page.url.search) {
					// Full reload: client-side navigation to the same route reuses the
					// component, and this initialisation would not run again.
					location.replace(target);
					return;
				}
			}
			session = stored;
		} else {
			// Every workout starts with the overview; the clock starts with "Starta passet".
			// It is saved on the first change, so only looking at a workout leaves nothing behind.
			session = createActiveSession(data.workout, infos, new Date(), { preparing: true });
		}
		if (completeExpiredTimers(session, new Date())) persist();
	});

	function persist() {
		if (!session) return;
		touch(session, new Date());
		storageWarning = !saveActiveSession($state.snapshot(session));
	}

	/** Runs a change and saves to localStorage right away. */
	function change(fn: (s: ActiveSession) => void) {
		if (!session) return;
		fn(session);
		persist();
	}

	function buzz(pattern: number | number[] = 12) {
		try {
			navigator.vibrate?.(pattern);
		} catch {
			// No vibration support, nothing to do.
		}
	}

	// --- moving between exercises -----------------------------------------

	const cur = $derived(session ? Math.max(0, Math.min(session.current ?? 0, session.exercises.length - 1)) : 0);
	const ex = $derived(session?.exercises[cur]);
	const info = $derived(ex ? infos.get(ex.exerciseId) : undefined);
	const isLast = $derived(session ? cur === session.exercises.length - 1 : false);

	const allDone = (sets: ActiveSet[]) => sets.length > 0 && sets.every((s) => s.done);
	const firstOpen = (sets: ActiveSet[]) => {
		const i = sets.findIndex((s) => !s.done);
		return i === -1 ? sets.length - 1 : i;
	};
	const focusOf = (i: number) => {
		const sets = session?.exercises[i]?.sets ?? [];
		const f = focus[i];
		return f !== undefined && f < sets.length ? f : firstOpen(sets);
	};

	/**
	 * If a timer is running, ask first what to do with the time. A focused
	 * field is blurred first so a typed weight is committed (its change event)
	 * before a swipe or navigation re-renders the set list.
	 */
	function guard(fn: () => void) {
		(document.activeElement as HTMLElement | null)?.blur?.();
		if (session && anyTimerRunning(session)) sheet = { kind: 'timer', then: fn };
		else fn();
	}

	function goTo(i: number) {
		guard(async () => {
			if (!session || i < 0 || i >= session.exercises.length) return;
			slide = i > cur ? 'in-right' : i < cur ? 'in-left' : '';
			change((s) => (s.current = i));
			mode = 'active';
			await tick();
			scrollTo({ top: 0 });
		});
	}

	function openFinish() {
		guard(() => {
			saveError = null;
			mode = 'finish';
			scrollTo({ top: 0 });
		});
	}

	// A sideways swipe changes exercise. touch-action: pan-y on the area keeps
	// Chrome on Android from taking over horizontal movement.
	let sx: number | null = null;
	let sy = 0;
	let swiped = false;
	function swipeStart(e: TouchEvent) {
		const t = e.changedTouches[0];
		if ((e.target as Element).closest('input, textarea')) return;
		sx = t.clientX;
		sy = t.clientY;
	}
	function swipeEnd(e: TouchEvent) {
		if (sx === null) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - sx;
		const dy = t.clientY - sy;
		sx = null;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
			swiped = true;
			setTimeout(() => (swiped = false), 350);
			goTo(cur + (dx < 0 ? 1 : -1));
		}
	}
	/** A swipe that ends on a button must not also count as a tap. */
	function eatClickAfterSwipe(e: MouseEvent) {
		if (!swiped) return;
		e.stopPropagation();
		e.preventDefault();
	}

	// --- timer -------------------------------------------------------------

	const timerRunning = $derived(session ? anyTimerRunning(session) : false);
	onMount(() => {
		const wakeLock = createWakeLock();
		const ticker = setInterval(() => {
			now = new Date();
			if (session && anyTimerRunning(session) && completeExpiredTimers(session, now)) {
				beep();
				buzz([30, 80, 30]);
				focus[cur] = firstOpen(session.exercises[cur].sets);
				persist();
				// The timer ran out while the user was deciding: the question is moot, carry on.
				if (sheet?.kind === 'timer') {
					const then = sheet.then;
					sheet = null;
					then();
				}
			}
		}, 250);
		const stopWatching = $effect.root(() => {
			$effect(() => wakeLock.set(timerRunning));
		});
		return () => {
			clearInterval(ticker);
			stopWatching();
			wakeLock.destroy();
		};
	});

	function runningSet(): { set: ActiveSet; exIndex: number; setIndex: number } | null {
		if (!session) return null;
		for (const [exIndex, e] of session.exercises.entries())
			for (const [setIndex, set] of e.sets.entries()) if (isTimerRunning(set)) return { set, exIndex, setIndex };
		return null;
	}
	const running = $derived(timerRunning ? runningSet() : null);
	const runningLeft = $derived(running?.set.timerEndsAt ? Math.max(0, Math.ceil((Date.parse(running.set.timerEndsAt) - now.getTime()) / 1000)) : 0);
	// Same rounding as stopTimer, so the sheet shows the time that will be saved.
	const runningGone = $derived(
		running?.set.timerEndsAt && 'seconds' in running.set
			? Math.max(0, Math.round((running.set.timerDuration ?? running.set.seconds) - remainingMs(running.set, now) / 1000))
			: 0
	);

	function resolveTimer(keep: boolean) {
		const r = runningSet();
		if (!r || sheet?.kind !== 'timer') return;
		const then = sheet.then;
		change(() => (keep ? stopTimer(r.set, new Date()) : cancelTimer(r.set)));
		if (keep) focus[r.exIndex] = firstOpen(session!.exercises[r.exIndex].sets);
		sheet = null;
		then();
	}

	// --- set ---------------------------------------------------------------

	function check(setIndex: number) {
		const set = ex!.sets[setIndex];
		if (isTimerRunning(set)) return guard(() => {});
		change(() => (set.done = !set.done));
		if (set.done) {
			buzz();
			focus[cur] = firstOpen(ex!.sets);
			if (allDone(ex!.sets)) buzz([12, 60, 12]);
		}
	}

	function step(setIndex: number, field: SetField, delta: number) {
		const set = ex!.sets[setIndex] as unknown as Partial<Record<SetField, number>>;
		const value = set[field];
		if (value === undefined) return;
		change((s) => setField(s.exercises[cur].sets[setIndex], field, Math.max(field === 'seconds' ? 5 : 0, value + delta)));
	}

	function remove(setIndex: number) {
		const exIndex = cur;
		const removed = $state.snapshot(ex!.sets[setIndex]);
		change((s) => removeSet(s.exercises[exIndex].sets, setIndex));
		focus[exIndex] = Math.min(focusOf(exIndex), Math.max(0, session!.exercises[exIndex].sets.length - 1));
		showUndo('Set borttaget', () => change((s) => s.exercises[exIndex].sets.splice(setIndex, 0, removed)));
	}

	function showUndo(text: string, run: () => void) {
		clearTimeout(undoTimer);
		undo = { text, run };
		undoTimer = setTimeout(() => (undo = null), 4000);
	}

	function add() {
		change((s) => addSet(s.exercises[cur].sets, info!.type));
		focus[cur] = ex!.sets.length - 1;
	}

	/** New record for a done set: best set (1RM, reps, time) or heaviest weight. */
	function isRecord(i: ExerciseInfo | undefined, set: ActiveSet): boolean {
		if (!i || !set.done) return false;
		const best = bestSet(i.type, [set]);
		if (i.best !== undefined && best && best.value > i.best) return true;
		const heaviest = heaviestWeight(i.type, [set]);
		return i.heaviest !== undefined && heaviest !== null && heaviest > i.heaviest;
	}

	function previous(i: ExerciseInfo | undefined, setIndex: number): string {
		const sets = i?.lastEntry?.sets;
		const s = sets?.[setIndex];
		if (!s) return '–';
		if ('weight' in s) return `${formatNumber(s.weight)}×${s.reps}`;
		if ('seconds' in s) return formatSeconds(s.seconds);
		return String(s.reps);
	}

	function setText(type: ExerciseType, s: ActiveSet): string {
		if ('weight' in s) return `${formatNumber(s.weight)}×${s.reps}`;
		if ('seconds' in s) return formatSeconds(s.seconds);
		return type === 'bodyweight' ? `${s.reps}` : '?';
	}

	/** The template target for the original exercise in this position. */
	function templateTarget(exerciseId: string) {
		const original = session?.deviations.find((d) => d.to === exerciseId)?.from ?? exerciseId;
		return data.workout.exercises.find((e) => e.exerciseId === original)?.target;
	}

	const isSwappedIn = (exerciseId: string) => session?.deviations.some((d) => d.to === exerciseId) ?? false;

	function targetText(exerciseId: string, sets: number) {
		const t = templateTarget(exerciseId);
		if (!t) return null;
		return 'seconds' in t ? `${sets} × ${t.seconds} s` : `${sets} × ${t.reps}`;
	}

	function lastText(i: ExerciseInfo | undefined) {
		const s = i?.lastEntry?.sets[0];
		if (!s) return null;
		if ('weight' in s) return `${formatNumber(s.weight)} kg × ${s.reps}`;
		if ('seconds' in s) return formatSeconds(s.seconds);
		return `${s.reps} reps`;
	}

	// --- helper --------------------------------------------------------------

	interface HelpState {
		/** Questions and answers sent as history (always in pairs). */
		turns: { role: 'user' | 'assistant'; text: string }[];
		log: { role: 'user' | 'assistant' | 'event'; text: string }[];
		busy: boolean;
		error: string | null;
	}
	let help = $state<Record<string, HelpState>>({});

	function openHelp(exerciseId: string) {
		help[exerciseId] ??= { turns: [], log: [], busy: false, error: null };
		sheet = { kind: 'help', exerciseId };
	}

	/** Bumped by "Ångra byten", so a reply that arrives afterwards does not swap again. */
	let helpRound = 0;

	async function ask(exerciseId: string, question: string) {
		const state = help[exerciseId];
		if (!session || !state || state.busy) return;
		const round = helpRound;
		state.busy = true;
		state.error = null;
		state.log.push({ role: 'user', text: question });
		try {
			const res = await fetch('/api/helper', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					session: $state.snapshot(session),
					exerciseId,
					history: $state.snapshot(state.turns),
					question
				})
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `Servern svarade ${res.status}`);
			state.turns.push({ role: 'user', text: question }, { role: 'assistant', text: body.reply });
			state.log.push({ role: 'assistant', text: body.reply });
			if (body.swap && round === helpRound) {
				const { from, to } = body.swap as { from: string; to: ExerciseInfo };
				swap(from, to);
				state.log.push({ role: 'event', text: `Bytte till ${to.name}` });
				// Help about one exercise follows it to the new one; help about the whole workout stays put.
				if (exerciseId) {
					help[to.id] = state;
					delete help[from];
					sheet = { kind: 'help', exerciseId: to.id };
				}
			}
		} catch (e) {
			// fetch() rejects with a TypeError when offline; show that in Swedish rather than "Failed to fetch".
			state.error =
				e instanceof TypeError ? 'Ingen kontakt med servern. Försök igen.' : e instanceof Error ? e.message : 'Något gick fel. Försök igen.';
		} finally {
			state.busy = false;
		}
	}

	// --- notes ---------------------------------------------------------------

	function openNote(index: number) {
		sheet = { kind: 'note', index, text: session?.exercises[index]?.note ?? '' };
	}

	function saveNote() {
		if (sheet?.kind !== 'note') return;
		const { index, text } = sheet;
		const note = text.trim().slice(0, NOTE_MAX);
		change((s) => {
			if (note) s.exercises[index].note = note;
			else delete s.exercises[index].note;
		});
		sheet = null;
	}

	// --- swapping and starting ---------------------------------------------

	/** Swaps for this workout only; during the workout the new exercise is shown. */
	function swap(from: string, to: ExerciseInfo) {
		if (!session) return;
		const target = templateTarget(from);
		if (!infos.has(to.id)) swappedIn.push(to);
		change((s) => applySwap(s, from, to, target));
		if (session.preparing) {
			// Swapped back to the plan: nothing is prepared any more.
			if (!session.deviations.length) clearActiveSession();
			return;
		}
		const index = session.exercises.findIndex((e) => e.exerciseId === to.id);
		if (index >= 0) change((s) => (s.current = index));
	}

	function pick(from: string, to: ExerciseInfo) {
		swap(from, to);
		sheet = null;
	}

	/** Swaps to an exercise written in; one written in earlier with the same name and type is reused. */
	function pickNew(from: string, fields: Omit<NewSessionExercise, 'id'>) {
		if (!session) return;
		let entry = findSameExercise(session.newExercises ?? [], fields);
		if (!entry) {
			entry = { id: newExerciseId(), ...fields };
			// Ones swapped away again without a done set are dropped, so they don't count toward the limit.
			const added = entry;
			change((s) => {
				s.newExercises = [...(s.newExercises ?? []).filter((n) => s.exercises.some((e) => e.exerciseId === n.id)), added];
			});
		}
		pick(from, { id: entry.id, name: entry.name, type: entry.type, instruction: entry.instruction });
	}

	/** From the swap list to Milon, with the swap question already asked. */
	function askMilonToSwap(exerciseId: string) {
		openHelp(exerciseId);
		void ask(exerciseId, swapQuestion(infos.get(exerciseId)?.name ?? exerciseId));
	}

	/** Back to the workout as planned: the preparation is dropped. */
	function resetPreparation() {
		clearActiveSession();
		helpRound++;
		help = {};
		// An older version (?v=) was kept for the swaps; without them the latest applies.
		if (page.url.search) return location.replace(`/pass/${data.workout.slug}`);
		session = createActiveSession(data.workout, infos, new Date(), { preparing: true });
	}

	function startWorkout() {
		unlockAudio();
		change((s) => startPreparedSession(s, new Date()));
		focus = {};
		now = new Date();
	}

	// --- finish -----------------------------------------------------------

	const doneSets = $derived(session ? session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0) : 0);
	const totalSets = $derived(session ? session.exercises.reduce((n, e) => n + e.sets.length, 0) : 0);
	const recordCount = $derived(
		session ? session.exercises.filter((e) => e.sets.some((s) => isRecord(infos.get(e.exerciseId), s))).length : 0
	);
	const elapsed = $derived(session ? formatSeconds((now.getTime() - Date.parse(session.startedAt)) / 1000) : '');

	async function save() {
		if (!session) return;
		saving = true;
		saveError = null;
		const body = {
			session: $state.snapshot(session),
			endedAt: localIsoString(new Date()),
			kcalEstimate: Number.isFinite(kcal) && kcal >= 0 ? kcal : undefined,
			saveAsNewVersion: session.deviations.length > 0 && saveAsNewVersion
		};
		try {
			let res: Response;
			try {
				res = await fetch('/api/sessions', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				});
			} catch (e) {
				// No network: queue the workout; it is sent when the network is back.
				const userId = page.data.userId as string | null;
				const key = pendingKey(session.sessionId, session.startedAt);
				if (isNetworkError(e) && userId && queueSave({ key, userId, workoutName: data.workout.name, body })) {
					clearActiveSession();
					await goto('/').catch(() => (location.href = '/'));
					return;
				}
				throw e;
			}
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Servern svarade ${res.status}`);
			}
			// The local workout is cleared only once the server has confirmed.
			clearActiveSession();
			await goto('/', { invalidateAll: true });
		} catch (e) {
			saveError = `${e instanceof Error ? e.message : 'Okänt fel'}. Passet ligger kvar i telefonen, försök igen.`;
		} finally {
			saving = false;
		}
	}

	function discard() {
		clearActiveSession();
		sheet = null;
		void goto('/');
	}
</script>

<svelte:head><title>{data.workout.name} · Milon-PT</title></svelte:head>

{#if other}
	<main>
		<div class="pagehead">
			<span class="label">{data.workout.name}</span>
			<h1>Ett annat pass pågår</h1>
		</div>
		<p class="muted">Avsluta eller släng det pågående passet innan du startar ett nytt.</p>
		<a class="btn primary full" href={`/pass/${other.workoutSlug}?v=${other.workoutVersion}`} data-sveltekit-reload>Fortsätt pågående pass</a>
		<a class="btn ghost full" href="/">Till start</a>
	</main>
{:else if session?.preparing}
	<header class="topbar">
		<a class="icon-btn" href="/" aria-label="Till start"><Icon name="x" /></a>
		<div class="mid"><span>Översikt</span></div>
		<span></span>
	</header>
	<main class="overview">
		{#if storageWarning}
			<p class="error warning">Kunde inte spara i telefonen. Byten kan försvinna om du stänger sidan.</p>
		{/if}
		<div class="pagehead">
			<span class="label">{session.exercises.length} övningar · {totalSets} set</span>
			<h1>{data.workout.name}</h1>
		</div>
		<ol class="ovlist">
			{#each session.exercises as e (e.exerciseId)}
				{@const ei = infos.get(e.exerciseId)}
				{@const target = targetText(e.exerciseId, e.sets.length)}
				{@const open = !!showInstruction[e.exerciseId]}
				<li class="ovitem">
					<div class="ovmain">
						<div class="ovtop">
							<h2>{ei?.name ?? e.exerciseId}</h2>
							{#if isSwappedIn(e.exerciseId)}<span class="tag quiet">Inbytt</span>{:else if ei && !ei.lastEntry}<span class="tag quiet">Ny</span>{/if}
						</div>
						<p class="ovmeta">
							{#if target}<span>Mål <span class="num">{target}</span></span>{/if}
							{#if ei?.instruction}
								<button class="link" aria-expanded={open} onclick={() => (showInstruction[e.exerciseId] = !open)}>
									Instruktion<Icon name={open ? 'up' : 'down'} size={16} />
								</button>
							{/if}
						</p>
						{#if ei?.lastEntry?.note}<p class="ovnote"><span>Förra:</span> {ei.lastEntry.note}</p>{/if}
					</div>
					<div class="ovactions">
						<button class="btn small swapbtn" onclick={() => (sheet = { kind: 'swap', exerciseId: e.exerciseId })} aria-label="Byt {ei?.name ?? e.exerciseId}">
							<Icon name="swap" /> Byt
						</button>
						{#if data.helperAvailable && ei}
							<!-- The same small Milon icon on every row, so the rows look alike whether or not there is an instruction. -->
							<button class="icon-btn milonbtn" onclick={() => openHelp(e.exerciseId)} aria-label="Fråga Milon om {ei.name}">
								<MilonAvatar size={24} tight />
							</button>
						{/if}
					</div>
					{#if open && ei?.instruction}
						<div class="ovinstr">
							<p class="instruction">{ei.instruction}</p>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
		{#if data.helperAvailable}
			<button class="btn full askall" onclick={() => openHelp('')}><MilonAvatar size={22} tight /> Fråga Milon om passet</button>
		{/if}
		{#if session.deviations.length}
			<button class="btn ghost full reset" onclick={resetPreparation}>Ångra byten</button>
		{/if}
	</main>
	<div class="actionbar single">
		<button class="btn primary" onclick={startWorkout}>Starta passet</button>
	</div>
{:else if session && ex && mode === 'active'}
	<header class="topbar">
		<button class="icon-btn" onclick={() => guard(() => (sheet = { kind: 'close' }))} aria-label="Stäng passet"><Icon name="x" /></button>
		<div class="mid">
			<span>{data.workout.name}</span>
			<span class="num">{elapsed}</span>
		</div>
		<button class="end" onclick={openFinish}>Avsluta</button>
	</header>

	<div class="progress" role="group" aria-label="Övningar">
		{#each session.exercises as e, i (e.exerciseId + i)}
			<button
				class:current={i === cur}
				class:done={i !== cur && allDone(e.sets)}
				onclick={() => goTo(i)}
				aria-label="Övning {i + 1}: {infos.get(e.exerciseId)?.name ?? e.exerciseId}{allDone(e.sets) ? ', klar' : ''}{i === cur ? ', visas nu' : ''}"
			><i></i></button>
		{/each}
	</div>

	{#key cur}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<section class="exercise {slide}" ontouchstart={swipeStart} ontouchend={swipeEnd} ontouchcancel={() => (sx = null)} onclickcapture={eatClickAfterSwipe}>
			{#if storageWarning}
				<p class="error warning">Kunde inte spara i telefonen. Stäng inte sidan innan passet är sparat.</p>
			{/if}
			<div class="overline">
				Övning {cur + 1} av {session.exercises.length}
				{#if isSwappedIn(ex.exerciseId)}<span class="tag quiet">Inbytt</span>{/if}
			</div>
			<h1 class="exname">{info?.name ?? ex.exerciseId}</h1>
			{#if info}
				{@const target = targetText(ex.exerciseId, ex.sets.length)}
				{@const last = lastText(info)}
				<p class="subline">
					{#if target}Mål <span class="num">{target}</span>{/if}{#if target && last}&nbsp;·&nbsp;{/if}{#if last}förra <span class="num">{last}</span>{/if}
				</p>
				<div class="actions">
					{#if info.instruction}
						<button class="btn small" aria-expanded={!!showInstruction[ex.exerciseId]} onclick={() => (showInstruction[ex.exerciseId] = !showInstruction[ex.exerciseId])}>
							Instruktion <Icon name={showInstruction[ex.exerciseId] ? 'up' : 'down'} />
						</button>
					{/if}
					<button class="btn small" onclick={() => guard(() => (sheet = { kind: 'swap', exerciseId: ex.exerciseId }))}><Icon name="swap" /> Byt</button>
					<button class="btn small" aria-haspopup="dialog" onclick={() => openNote(cur)}><Icon name="note" /> Anteckning</button>
					{#if data.helperAvailable}
						<button class="btn small" onclick={() => openHelp(ex.exerciseId)}><MilonAvatar size={20} tight /> Fråga Milon</button>
					{/if}
				</div>
				{#if showInstruction[ex.exerciseId]}<p class="instruction">{info.instruction}</p>{/if}
				{#if info.lastEntry?.note}
					<p class="lastnote"><span>Förra gången:</span> {info.lastEntry.note}</p>
				{/if}
				{#if ex.note}
					<button class="lastnote mine" onclick={() => openNote(cur)} aria-label="Din anteckning: {ex.note}. Tryck för att ändra."
						><span>I dag:</span> {ex.note}</button
					>
				{/if}

				<div class="sets">
					<div class="sethead" class:one={info.type !== 'weight'}>
						<span>Set</span><span>Förra</span>
						{#if info.type === 'weight'}<span>Kg</span><span>Reps</span>{:else}<span>{info.type === 'time' ? 'Tid' : 'Reps'}</span>{/if}
						<span></span>
					</div>
					{#each ex.sets as set, setIndex (setIndex)}
						<SetRow
							{set}
							type={info.type}
							index={setIndex}
							previous={previous(info, setIndex)}
							active={setIndex === focusOf(cur)}
							record={isRecord(info, set)}
							{now}
							onfocus={() => guard(() => (focus[cur] = setIndex))}
							oncheck={() => check(setIndex)}
							onstep={(field, delta) => step(setIndex, field, delta)}
							onset={(field, value) => change((s) => setField(s.exercises[cur].sets[setIndex], field, value))}
							onremove={() => remove(setIndex)}
							onstarttimer={() => {
								unlockAudio();
								change((s) => startTimer(s.exercises[cur].sets[setIndex], new Date()));
							}}
							onstoptimer={() => {
								change((s) => stopTimer(s.exercises[cur].sets[setIndex], new Date()));
								focus[cur] = firstOpen(ex.sets);
							}}
						/>
					{/each}
				</div>
				<button class="btn full add" onclick={add}><Icon name="plus" /> Lägg till set</button>
				{@const upcoming = session.exercises.slice(cur + 1).map((e) => infos.get(e.exerciseId)?.name ?? e.exerciseId)}
				{#if upcoming.length}
					<p class="nextline">
						<span class="label">Nästa</span>
						<span>{upcoming.slice(0, 2).join(', ')}{upcoming.length > 2 ? ` +${upcoming.length - 2}` : ''}</span>
					</p>
				{/if}
			{:else}
				<p class="error">Övningen {ex.exerciseId} finns inte längre. Hoppa till nästa övning.</p>
			{/if}
		</section>
	{/key}

	<div class="actionbar">
		<button class="btn" onclick={() => goTo(cur - 1)} disabled={cur === 0} aria-label="Föregående övning"><Icon name="left" /></button>
		{#if isLast}
			<button class="btn" class:primary={allDone(ex.sets)} onclick={openFinish}>Sammanfattning <Icon name="right" /></button>
		{:else}
			{@const next = session.exercises[cur + 1]}
			<button class="btn" class:primary={allDone(ex.sets)} onclick={() => goTo(cur + 1)}>
				<span class="ellipsis">Nästa: {infos.get(next.exerciseId)?.name ?? next.exerciseId}</span>
				<Icon name="right" />
			</button>
		{/if}
	</div>
{:else if session && mode === 'finish'}
	<header class="topbar">
		<button class="icon-btn" onclick={() => (mode = 'active')} aria-label="Tillbaka till passet"><Icon name="left" /></button>
		<div class="mid">
			<span>{data.workout.name}</span>
			<span class="num">{elapsed}</span>
		</div>
		<span></span>
	</header>
	<main class="finish">
		<div class="pagehead">
			<span class="label">Sammanfattning</span>
			<h1>{doneSets ? 'Snyggt jobbat' : 'Inget avbockat än'}</h1>
		</div>
		<div class="stats">
			<div class="stat"><span class="num">{elapsed}</span><span class="label">Tid</span></div>
			<div class="stat"><span class="num">{doneSets}<small>/{totalSets}</small></span><span class="label">Set klara</span></div>
			<div class="stat"><span class="num">{recordCount}</span><span class="label">Rekord</span></div>
		</div>

		<ul class="sumlist">
			{#each session.exercises as e, i (e.exerciseId + i)}
				{@const ei = infos.get(e.exerciseId)}
				{@const done = e.sets.filter((s) => s.done)}
				<li>
					<button
						class="sumrow"
						class:skipped={!done.length}
						onclick={() => goTo(i)}
						aria-label="{ei?.name ?? e.exerciseId}: ändra{e.note && !done.length ? '. Anteckningen sparas inte, inga set klara' : ''}"
					>
						<span class="name">
							{ei?.name ?? e.exerciseId}
							{#if e.sets.some((s) => isRecord(ei, s))}<span class="tag">PR</span>{/if}
							{#if isSwappedIn(e.exerciseId)}<span class="tag quiet">Inbytt</span>{/if}
						</span>
						<span class="setsline num">{done.length ? done.map((s) => setText(ei?.type ?? 'bodyweight', s)).join(' · ') : 'Inga set klara'}</span>
						{#if e.note}<span class="sumnote">{e.note}{#if !done.length}<em>{' · sparas inte'}</em>{/if}</span>{/if}
						<span class="go"><Icon name="right" /></span>
					</button>
				</li>
			{/each}
		</ul>

		{#if session.deviations.length}
			<div class="question">
				<p>Du bytte övning. Spara ändringen i {data.workout.name} till nästa gång?</p>
				<div class="seg2">
					<button class="btn" aria-pressed={saveAsNewVersion} onclick={() => (saveAsNewVersion = true)}>Ja, ny version</button>
					<button class="btn" aria-pressed={!saveAsNewVersion} onclick={() => (saveAsNewVersion = false)}>Nej, bara idag</button>
				</div>
			</div>
		{/if}

		<label class="kcal">
			<span>Uppskattad förbränning</span>
			<span><input class="num" type="number" inputmode="numeric" min="0" step="10" bind:value={kcal} /> <span class="muted">kcal</span></span>
		</label>

		{#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
		<div class="final">
			<button class="btn primary full" onclick={save} disabled={saving || doneSets === 0}>{saving ? 'Sparar…' : 'Avsluta pass'}</button>
			{#if doneSets === 0}<p class="muted center">Bocka av minst ett set för att kunna spara.</p>{/if}
			<button class="btn ghost full" onclick={() => (sheet = { kind: 'discard' })}>Släng passet</button>
		</div>
	</main>
{/if}

{#if sheet?.kind === 'timer' && running}
	{@const rex = session?.exercises[running.exIndex]}
	<Sheet title="Timern går" onclose={() => (sheet = null)}>
		<h2 class="sheet-title">Timern går</h2>
		<p class="muted">
			{infos.get(rex?.exerciseId ?? '')?.name}, set {running.setIndex + 1}: <span class="num">{formatSeconds(runningLeft)}</span> kvar. Vad vill du göra med tiden?
		</p>
		<button class="btn primary full" onclick={() => resolveTimer(true)}>Stoppa och spara <span class="num">{formatSeconds(runningGone)}</span></button>
		<button class="btn full" onclick={() => resolveTimer(false)}>Släng tiden</button>
		<button class="btn ghost full" onclick={() => (sheet = null)}>Fortsätt timern</button>
	</Sheet>
{:else if sheet?.kind === 'close'}
	<Sheet title="Lämna passet?" onclose={() => (sheet = null)}>
		<h2 class="sheet-title">Lämna passet?</h2>
		<p class="muted">Pausa sparar allt i telefonen så att du kan fortsätta senare. Släng tar bort passet utan att logga något.</p>
		<button class="btn primary full" onclick={() => goto('/')}>Pausa och gå till start</button>
		<button class="btn full" onclick={() => (sheet = { kind: 'discard' })}>Släng passet</button>
		<button class="btn ghost full" onclick={() => (sheet = null)}>Stanna kvar</button>
	</Sheet>
{:else if sheet?.kind === 'discard'}
	<Sheet title="Släng passet?" onclose={() => (sheet = null)}>
		<h2 class="sheet-title">Släng passet?</h2>
		<p class="muted">Inget av passet loggas. Det går inte att ångra.</p>
		<button class="btn primary full" onclick={discard}>Släng passet</button>
		<button class="btn ghost full" onclick={() => (sheet = null)}>Avbryt</button>
	</Sheet>
{:else if sheet?.kind === 'swap' && session}
	{@const id = sheet.exerciseId}
	<Sheet title="Byt övning" onclose={() => (sheet = null)}>
		<SwapPicker
			name={infos.get(id)?.name ?? id}
			type={infos.get(id)?.type}
			catalog={data.catalog}
			{session}
			onaskmilon={data.helperAvailable ? () => askMilonToSwap(id) : undefined}
			onpick={(to) => pick(id, to)}
			onnew={(fields) => pickNew(id, fields)}
			onclose={() => (sheet = null)}
		/>
	</Sheet>
{:else if sheet?.kind === 'note' && session}
	{@const name = infos.get(session.exercises[sheet.index]?.exerciseId ?? '')?.name ?? ''}
	<Sheet title="Anteckning" onclose={() => (sheet = null)}>
		<h2 class="sheet-title">Anteckning · {name}</h2>
		<p class="muted">Sparas med övningens set och visas nästa gång, t.ex. "Prova 25 kg".</p>
		<textarea bind:value={sheet.text} maxlength={NOTE_MAX} rows="4" aria-label="Anteckning för {name}" placeholder="Skriv en anteckning"></textarea>
		<button class="btn primary full" onclick={saveNote}>Spara anteckning</button>
		<button class="btn ghost full" onclick={() => (sheet = null)}>Avbryt</button>
	</Sheet>
{:else if sheet?.kind === 'help' && help[sheet.exerciseId]}
	{@const id = sheet.exerciseId}
	{@const state = help[id]}
	<Sheet title="Fråga Milon" onclose={() => (sheet = null)}>
		<HelpPanel
			name={id ? (infos.get(id)?.name ?? id) : data.workout.name}
			workout={!id}
			log={state.log}
			busy={state.busy}
			error={state.error}
			onask={(q) => ask(id, q)}
			onclose={() => (sheet = null)}
		/>
	</Sheet>
{/if}

{#if undo}
	<div class="toast" role="status">
		{undo.text}
		<button
			onclick={() => {
				undo?.run();
				undo = null;
			}}>Ångra</button
		>
	</div>
{/if}

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		height: calc(56px + env(safe-area-inset-top, 0px));
		padding: env(safe-area-inset-top, 0px) 8px 0 6px;
		display: grid;
		grid-template-columns: 56px 1fr 56px;
		align-items: center;
		background: var(--bg);
		max-width: 30rem;
		margin: 0 auto;
	}
	.mid {
		display: grid;
		text-align: center;
		line-height: 1.2;
	}
	.mid span:first-child {
		font-size: 13px;
		font-weight: 500;
		color: var(--muted);
	}
	.mid .num {
		font-size: 15px;
	}
	.end {
		background: none;
		border: 0;
		min-height: 44px;
		border-radius: 14px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		justify-self: end;
		padding: 0 6px;
	}
	.progress {
		display: flex;
		gap: 4px;
		padding: 0 20px;
		max-width: 30rem;
		margin: 0 auto;
	}
	/* 4 px bars with a 44 px tap target; the negative margin keeps the visual spacing. */
	.progress button {
		flex: 1;
		height: 44px;
		margin: -10px 0;
		padding: 20px 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.progress i {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: var(--seg);
	}
	.progress .done i {
		background: var(--accent);
	}
	.progress .current i {
		background: var(--text);
	}
	.exercise {
		max-width: 30rem;
		margin: 0 auto;
		padding: 0 20px 24px;
		touch-action: pan-y;
		min-height: calc(100dvh - 160px);
	}
	.in-left {
		animation: inleft 220ms ease-out;
	}
	.in-right {
		animation: inright 220ms ease-out;
	}
	@keyframes inleft {
		from {
			transform: translateX(-28px);
			opacity: 0.2;
		}
	}
	@keyframes inright {
		from {
			transform: translateX(28px);
			opacity: 0.2;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.in-left,
		.in-right {
			animation: none;
		}
	}
	.warning {
		margin: 12px 0 0;
		font-size: 14px;
	}
	.overline {
		margin-top: 20px;
		font-size: 13px;
		font-weight: 500;
		color: var(--muted);
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.exname {
		margin-top: 6px;
		font-size: clamp(34px, 11vw, 48px);
		font-weight: 600;
		line-height: 1.05;
		letter-spacing: 0.01em;
		color: var(--heading);
		overflow-wrap: anywhere;
	}
	.subline {
		margin: 8px 0 0;
		font-size: 14px;
		color: var(--muted);
	}
	.subline .num {
		font-size: 13px;
	}
	.actions {
		margin-top: 12px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.instruction {
		margin: 12px 0 0;
		padding: 12px 14px;
		border-radius: 14px;
		background: var(--surface);
		font-size: 14px;
		color: var(--soft);
		white-space: pre-line;
	}
	.lastnote {
		overflow-wrap: anywhere;
		margin: 12px 0 0;
		padding-left: 10px;
		border-left: 2px solid var(--line);
		font-size: 14px;
		color: var(--soft);
		white-space: pre-line;
	}
	.lastnote.mine {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		border-left: 2px solid var(--accent);
		padding: 0 0 0 10px;
		font: inherit;
		font-size: 14px;
		color: var(--soft);
		cursor: pointer;
	}
	.sumnote {
		grid-column: 1;
		overflow-wrap: anywhere;
		font-size: 13px;
		color: var(--muted);
		white-space: pre-line;
	}
	textarea {
		width: 100%;
		padding: 12px 14px;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
		resize: vertical;
	}
	.lastnote span {
		color: var(--muted);
	}
	.sets {
		margin-top: 24px;
	}
	.sethead {
		display: grid;
		grid-template-columns: 28px 64px 1fr 1fr 44px;
		gap: 8px;
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
		padding-bottom: 8px;
		border-bottom: 1px solid var(--line);
	}
	.sethead.one {
		grid-template-columns: 28px 64px 1fr 44px;
	}
	.add {
		margin-top: 14px;
	}
	.nextline {
		margin: 12px 0 0;
		padding: 14px 0;
		border-top: 1px solid var(--line);
		display: flex;
		gap: 10px;
		font-size: 14px;
		color: var(--soft);
	}
	.actionbar {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: grid;
		grid-template-columns: 48px 1fr;
		gap: 8px;
		padding: 12px 20px calc(12px + env(safe-area-inset-bottom, 0px));
		background: var(--bg);
		border-top: 1px solid var(--line);
		max-width: 30rem;
		margin: 0 auto;
	}
	.actionbar:not(.single) .btn:first-child {
		padding: 0;
	}
	.actionbar.single {
		grid-template-columns: 1fr;
	}
	.overview {
		padding-top: 4px;
	}
	/* A plain list with hairlines: the overview is for scanning, not for reading cards. */
	.ovlist {
		list-style: none;
		margin: 16px 0 0;
		padding: 0;
		border-top: 1px solid var(--line);
	}
	.ovitem {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.ovtop {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.ovtop h2 {
		font-size: 17px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.ovmeta {
		margin: 2px 0 0;
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 14px;
		color: var(--muted);
	}
	.ovmeta .num {
		font-size: 13px;
	}
	/* 44 px tap target; the negative margin keeps the row compact. */
	.ovmeta .link {
		min-height: 44px;
		margin: -6px 0;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0;
		text-decoration: none;
		color: var(--soft);
	}
	.ovnote {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--soft);
		white-space: pre-line;
	}
	.ovnote span {
		color: var(--muted);
	}
	.ovactions {
		display: flex;
		align-items: center;
	}
	.swapbtn {
		background: none;
		color: var(--soft);
		padding: 0 8px;
	}
	.ovinstr {
		grid-column: 1 / -1;
		display: grid;
		gap: 8px;
		justify-items: start;
		padding-top: 4px;
	}
	.ovinstr .instruction {
		margin: 0;
		background: var(--surface);
	}
	.askall {
		margin-top: 20px;
	}
	.reset {
		margin-top: 8px;
	}
	.ellipsis {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.finish {
		padding-top: 0;
	}
	.stats {
		margin-top: 20px;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.stat {
		background: var(--surface);
		border-radius: 14px;
		padding: 12px 14px;
		display: grid;
		gap: 2px;
	}
	.stat .num {
		font-size: 24px;
		font-weight: 500;
		letter-spacing: -0.03em;
	}
	.stat small {
		font-size: 14px;
		color: var(--muted);
	}
	.stat .label {
		font-size: 12px;
	}
	.sumlist {
		list-style: none;
		margin: 20px 0 0;
		padding: 0;
		border-top: 1px solid var(--line);
	}
	.sumrow {
		width: 100%;
		background: none;
		border: 0;
		border-bottom: 1px solid var(--line);
		padding: 14px 0;
		text-align: left;
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 12px;
		align-items: center;
		cursor: pointer;
	}
	.sumrow .name {
		font-size: 17px;
		font-weight: 600;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.setsline {
		font-size: 13px;
		color: var(--soft);
	}
	.skipped .name,
	.skipped .setsline {
		color: var(--dim);
	}
	.go {
		grid-row: 1 / span 2;
		grid-column: 2;
		color: var(--muted);
	}
	.question {
		margin-top: 24px;
		display: grid;
		gap: 10px;
	}
	.question p {
		margin: 0;
	}
	.seg2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.seg2 [aria-pressed='true'] {
		background: var(--text);
		color: var(--bg);
	}
	.kcal {
		margin-top: 20px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.kcal input {
		width: 96px;
		min-height: 48px;
		border-radius: 14px;
		border: 0;
		background: var(--surface-2);
		text-align: right;
		padding: 0 14px;
		font-size: 18px;
	}
	.final {
		margin-top: 24px;
		display: grid;
		gap: 4px;
	}
	.center {
		text-align: center;
		font-size: 13px;
		margin: 4px 0;
	}
	.sheet-title {
		font-size: 20px;
		font-weight: 600;
	}
	main p {
		margin: 12px 0;
	}
	main > .btn {
		margin-top: 8px;
	}
</style>
