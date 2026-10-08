/**
 * Logic for the active session. Plain functions that mutate the objects they
 * get, so they work directly on Svelte state and can be tested without a DOM.
 */
import {
	normalizeName,
	type ActiveSession,
	type ActiveSet,
	type ExerciseSet,
	type ExerciseType,
	type LogEntry,
	type Profile,
	type Target,
	type WorkoutTemplate
} from '$lib/model';

/** What the client needs to know about an exercise during the session. Only the latest log entry, never the whole log. */
export interface ExerciseInfo {
	id: string;
	name: string;
	type: ExerciseType;
	instruction: string;
	lastEntry?: LogEntry;
	/** Best value so far (1RM, reps or seconds), to mark records when finishing. */
	best?: number;
	/** Heaviest weight so far (weight exercises only). */
	heaviest?: number;
}

// --- time ---------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time as ISO 8601 with time zone, e.g. "2026-10-06T17:10:00+02:00". */
export function localIsoString(date: Date): string {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	const abs = Math.abs(offset);
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

/** Date part of a local ISO time: "2026-10-06T17:10:00+02:00" → "2026-10-06". */
export function localDateOf(iso: string): string {
	return iso.slice(0, 10);
}

// --- start --------------------------------------------------------------

function defaultSet(type: ExerciseType, target?: Target): ExerciseSet {
	if (type === 'time') return { seconds: target && 'seconds' in target ? target.seconds : 30 };
	const reps = target && 'reps' in target ? target.reps : 8;
	return type === 'weight' ? { weight: 0, reps } : { reps };
}

/** Picks out the set values without extra fields (such as `done` or timer fields). */
function setValues(type: ExerciseType, set: ExerciseSet): ExerciseSet {
	if (type === 'weight' && 'weight' in set) return { weight: set.weight, reps: set.reps };
	if (type === 'time' && 'seconds' in set) return { seconds: set.seconds };
	if (type === 'bodyweight' && 'reps' in set) return { reps: set.reps };
	return defaultSet(type);
}

/**
 * Prefills the sets from the exercise's latest log entry, otherwise from the
 * workout target. The number of sets follows the template; if last time had
 * fewer sets, the last one is repeated. A timed set that was stopped early
 * last time starts at the target again: the plan, not the reached time. With
 * `ownHistory` (an exercise swapped in, whose target belongs to the one it
 * replaced) its own logged times are used as they are.
 */
export function prefillSets(info: ExerciseInfo, count: number, target?: Target, options: { ownHistory?: boolean } = {}): ActiveSet[] {
	const previous = info.lastEntry?.sets ?? [];
	const planned = !options.ownHistory && target && 'seconds' in target ? target.seconds : 0;
	return Array.from({ length: Math.max(count, 1) }, (_, i) => {
		const from = previous[Math.min(i, previous.length - 1)];
		const values = from ? setValues(info.type, from) : defaultSet(info.type, target);
		if ('seconds' in values && values.seconds < planned) values.seconds = planned;
		return { ...values, done: false };
	});
}

/**
 * New session from the template. With `preparing` it starts as the overview
 * before the workout (see `startPreparedSession`).
 */
export function createActiveSession(
	workout: WorkoutTemplate,
	exercises: ReadonlyMap<string, ExerciseInfo>,
	now: Date,
	options: { preparing?: boolean } = {}
): ActiveSession {
	const startedAt = localIsoString(now);
	return {
		...(options.preparing ? { preparing: true } : {}),
		sessionId: sessionIdAt(startedAt),
		workoutSlug: workout.slug,
		workoutVersion: workout.version,
		startedAt,
		lastActivityAt: startedAt,
		exercises: workout.exercises.map((we) => {
			const info = exercises.get(we.exerciseId);
			return {
				exerciseId: we.exerciseId,
				sets: info ? prefillSets(info, we.sets, we.target) : []
			};
		}),
		deviations: []
	};
}

function sessionIdAt(startedAt: string): string {
	return `s_${localDateOf(startedAt).replaceAll('-', '')}`;
}

/** Starts a prepared session now: the clock starts and the id follows today's date. */
export function startPreparedSession(session: ActiveSession, now: Date): void {
	if (!session.preparing) return;
	delete session.preparing;
	session.startedAt = localIsoString(now);
	session.lastActivityAt = session.startedAt;
	session.sessionId = sessionIdAt(session.startedAt);
	session.current = 0;
}

/**
 * Exercises to offer in a swap: the catalog minus those already in the
 * session, matching `query` (case-insensitive, anywhere in the name), the
 * same type as the exercise swapped out first, then by name.
 */
export function swapCandidates(
	catalog: readonly ExerciseInfo[],
	session: ActiveSession,
	type: ExerciseType | undefined,
	query = ''
): ExerciseInfo[] {
	const inSession = new Set(session.exercises.map((e) => e.exerciseId));
	const q = normalizeName(query);
	return catalog
		.filter((e) => !inSession.has(e.id) && (!q || normalizeName(e.name).includes(q)))
		.sort((a, b) => Number(b.type === type) - Number(a.type === type) || a.name.localeCompare(b.name, 'sv'));
}

// --- changes ------------------------------------------------------------

export type SetField = 'weight' | 'reps' | 'seconds';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sets a field to a typed value. Invalid values are ignored. */
export function setField(set: ActiveSet, field: SetField, value: number): void {
	const values = set as unknown as Partial<Record<SetField, number>>;
	if (values[field] === undefined || !Number.isFinite(value) || value < 0) return;
	const next = field === 'weight' ? round2(value) : Math.round(value);
	// A time changed by hand replaces the plan from an earlier timer run.
	if (field === 'seconds' && next !== values[field]) delete set.plannedSeconds;
	values[field] = next;
}

/** New set with the same values as the last one, not marked as done. A timed set copies its plan (see `timerStartSeconds`). */
export function addSet(sets: ActiveSet[], type: ExerciseType): void {
	const last = sets[sets.length - 1];
	const values = last ? setValues(type, last) : defaultSet(type);
	if (last && 'seconds' in values) values.seconds = timerStartSeconds(last);
	sets.push({ ...values, done: false });
}

export function removeSet(sets: ActiveSet[], index: number): void {
	if (index >= 0 && index < sets.length) sets.splice(index, 1);
}

export function touch(session: ActiveSession, now: Date): void {
	session.lastActivityAt = localIsoString(now);
}

// --- timer --------------------------------------------------------------

export function isTimerRunning(set: ActiveSet): boolean {
	return set.timerEndsAt !== undefined;
}

export function remainingMs(set: ActiveSet, now: Date): number {
	if (!set.timerEndsAt) return 0;
	return Math.max(0, Date.parse(set.timerEndsAt) - now.getTime());
}

/** The time a timer started now counts down from: the plan after an early stop, otherwise the set's time. */
export function timerStartSeconds(set: ActiveSet): number {
	if (!('seconds' in set)) return 0;
	return set.plannedSeconds ?? set.seconds;
}

/** Starts the countdown from the planned time (see `timerStartSeconds`). */
export function startTimer(set: ActiveSet, now: Date): void {
	const seconds = timerStartSeconds(set);
	if (seconds <= 0) return;
	set.timerDuration = seconds;
	set.timerEndsAt = new Date(now.getTime() + seconds * 1000).toISOString();
	// The done flag is left as it is, so discarding the time ("Släng tiden") leaves the set as it was.
}

function clearTimer(set: ActiveSet): void {
	delete set.timerEndsAt;
	delete set.timerDuration;
}

/**
 * Stop before zero: the elapsed time is saved and the set is marked as done.
 * The planned time is kept so that a restart counts down from it again.
 */
export function stopTimer(set: ActiveSet, now: Date): void {
	if (!isTimerRunning(set) || !('seconds' in set)) return;
	const duration = set.timerDuration ?? set.seconds;
	set.seconds = Math.max(0, Math.round(duration - remainingMs(set, now) / 1000));
	if (set.seconds < duration) set.plannedSeconds = duration;
	else delete set.plannedSeconds;
	set.done = true;
	clearTimer(set);
}

/** Cancels without touching the time, the plan or the done flag. */
export function cancelTimer(set: ActiveSet): void {
	clearTimer(set);
}

/**
 * How long after zero a timer found on opening the workout still counts. A
 * timer that ran out longer ago is most likely from an app that Android killed
 * in the background, so its time is dropped (#57).
 */
export const EXPIRED_TIMER_GRACE_MS = 3 * 60_000;

/**
 * Fills in the reached time for timers that hit zero, even if that happened
 * while the page was closed. With `graceMs`, a timer that hit zero longer ago
 * than that is cancelled instead (no time, done flag unchanged). Returns the
 * number of timers that finished or were cancelled; the ticker beeps on it, so
 * it passes no `graceMs`.
 */
export function completeExpiredTimers(session: ActiveSession, now: Date, graceMs = Infinity): number {
	let changed = 0;
	for (const ex of session.exercises) {
		for (const set of ex.sets) {
			if (!isTimerRunning(set) || remainingMs(set, now) > 0 || !('seconds' in set)) continue;
			changed++;
			if (now.getTime() - Date.parse(set.timerEndsAt!) > graceMs) {
				cancelTimer(set);
				continue;
			}
			set.seconds = set.timerDuration ?? set.seconds;
			delete set.plannedSeconds;
			set.done = true;
			clearTimer(set);
		}
	}
	return changed;
}

export function anyTimerRunning(session: ActiveSession): boolean {
	return session.exercises.some((ex) => ex.sets.some(isTimerRunning));
}

// --- summary -----------------------------------------------------------

/**
 * Volume: weight = sum of weight × reps, bodyweight = sum of reps,
 * time = sum of seconds.
 */
export function volume(type: ExerciseType, sets: readonly ExerciseSet[]): number {
	let sum = 0;
	for (const s of sets) {
		if (type === 'weight' && 'weight' in s) sum += s.weight * s.reps;
		else if (type === 'bodyweight' && 'reps' in s) sum += s.reps;
		else if (type === 'time' && 'seconds' in s) sum += s.seconds;
	}
	return round2(sum);
}

export interface ExerciseSummary {
	exerciseId: string;
	name: string;
	type: ExerciseType;
	doneSets: number;
	totalSets: number;
	volume: number;
}

export interface SessionSummary {
	exercises: ExerciseSummary[];
	doneSets: number;
	/** Total volume per exercise type (kg, reps, seconds). */
	volumeByType: Record<ExerciseType, number>;
}

export function summarize(session: ActiveSession, infos: ReadonlyMap<string, ExerciseInfo>): SessionSummary {
	const volumeByType: Record<ExerciseType, number> = { weight: 0, bodyweight: 0, time: 0 };
	const exercises = session.exercises.map((ex) => {
		const info = infos.get(ex.exerciseId);
		const type = info?.type ?? 'bodyweight';
		const done = ex.sets.filter((s) => s.done);
		const v = volume(type, done);
		volumeByType[type] = round2(volumeByType[type] + v);
		return {
			exerciseId: ex.exerciseId,
			name: info?.name ?? ex.exerciseId,
			type,
			doneSets: done.length,
			totalSets: ex.sets.length,
			volume: v
		};
	});
	return { exercises, doneSets: exercises.reduce((n, e) => n + e.doneSets, 0), volumeByType };
}

/** Default: strength ~250–350 kcal. The profile's value for the workout takes precedence. */
export const DEFAULT_KCAL = 300;

/**
 * Suggested kcal when finishing: the profile's value for this workout, else
 * the middle of the profile's range for the workout type (HIIT if the name
 * says so, otherwise strength), else DEFAULT_KCAL.
 */
export function kcalSuggestion(profile: Profile, workout: Pick<WorkoutTemplate, 'slug' | 'name'>): number {
	const perWorkout = profile.kcalPerWorkout?.[workout.slug];
	if (perWorkout !== undefined) return perWorkout;
	const range = profile.kcalEstimates?.[/hiit/i.test(workout.name) ? 'hiit' : 'strength'];
	return range ? Math.round((range.min + range.max) / 2 / 10) * 10 : DEFAULT_KCAL;
}

// --- exercise swap ------------------------------------------------------

/**
 * Swaps an exercise in the active session (from the helper) and records the
 * swap as a deviation; the workout template is not touched.
 * - The new exercise gets prefilled sets, as many as the old one had.
 * - If the old exercise has done sets they are kept, and the new one is added after it.
 * - Swapping an already swapped-in exercise again updates the deviation (A→B→C becomes A→C),
 *   and swapping back to the original removes the deviation.
 */
export function applySwap(session: ActiveSession, fromId: string, to: ExerciseInfo, target?: Target): void {
	const index = session.exercises.findIndex((e) => e.exerciseId === fromId);
	if (index < 0 || session.exercises.some((e) => e.exerciseId === to.id)) return;

	const old = session.exercises[index];
	const fresh: ActiveSession['exercises'][number] = { exerciseId: to.id, sets: prefillSets(to, Math.max(old.sets.length, 1), target, { ownHistory: true }) };
	const done = old.sets.filter((s) => s.done);
	if (done.length) {
		// The note stays with the done sets it belongs to.
		old.sets = done;
		session.exercises.splice(index + 1, 0, fresh);
	} else {
		// Nothing done yet: today's note (often the reason for the swap) moves to the new exercise.
		if (old.note) fresh.note = old.note;
		session.exercises.splice(index, 1, fresh);
	}

	const earlier = session.deviations.findIndex((d) => d.type === 'swap' && d.to === fromId);
	if (earlier < 0) session.deviations.push({ type: 'swap', from: fromId, to: to.id });
	else if (session.deviations[earlier].from === to.id) session.deviations.splice(earlier, 1);
	else session.deviations[earlier] = { type: 'swap', from: session.deviations[earlier].from, to: to.id };
}
