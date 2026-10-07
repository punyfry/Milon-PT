/**
 * Logic for the active session. Plain functions that mutate the objects they
 * get, so they work directly on Svelte state and can be tested without a DOM.
 */
import {
	LOAD_STEP_KG,
	TIME_STEP_SECONDS,
	type ActiveSession,
	type ActiveSet,
	type ExerciseSet,
	type ExerciseType,
	type LoadClass,
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
	loadClass?: LoadClass;
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
 * fewer sets, the last one is repeated.
 */
export function prefillSets(info: ExerciseInfo, count: number, target?: Target): ActiveSet[] {
	const previous = info.lastEntry?.sets ?? [];
	return Array.from({ length: Math.max(count, 1) }, (_, i) => {
		const from = previous[Math.min(i, previous.length - 1)];
		const values = from ? setValues(info.type, from) : defaultSet(info.type, target);
		return { ...values, done: false };
	});
}

export function createActiveSession(
	workout: WorkoutTemplate,
	exercises: ReadonlyMap<string, ExerciseInfo>,
	now: Date
): ActiveSession {
	const startedAt = localIsoString(now);
	return {
		sessionId: `s_${localDateOf(startedAt).replaceAll('-', '')}`,
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

// --- changes ------------------------------------------------------------

export type SetField = 'weight' | 'reps' | 'seconds';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function stepFor(field: SetField, loadClass?: LoadClass): number {
	if (field === 'weight') return LOAD_STEP_KG[loadClass ?? 'light'];
	if (field === 'seconds') return TIME_STEP_SECONDS;
	return 1;
}

/** −/+ on a field. Never below zero. */
export function adjust(set: ActiveSet, field: SetField, direction: 1 | -1, loadClass?: LoadClass): void {
	const values = set as unknown as Partial<Record<SetField, number>>;
	const current = values[field];
	if (current === undefined) return;
	values[field] = Math.max(0, round2(current + direction * stepFor(field, loadClass)));
}

/** Sets a field to a typed value. Invalid values are ignored. */
export function setField(set: ActiveSet, field: SetField, value: number): void {
	const values = set as unknown as Partial<Record<SetField, number>>;
	if (values[field] === undefined || !Number.isFinite(value) || value < 0) return;
	values[field] = field === 'weight' ? round2(value) : Math.round(value);
}

/** New set with the same values as the last one, not marked as done. */
export function addSet(sets: ActiveSet[], type: ExerciseType): void {
	const last = sets[sets.length - 1];
	sets.push({ ...(last ? setValues(type, last) : defaultSet(type)), done: false });
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

/** Starts the countdown from the set's current time. */
export function startTimer(set: ActiveSet, now: Date): void {
	if (!('seconds' in set) || set.seconds <= 0) return;
	set.timerDuration = set.seconds;
	set.timerEndsAt = new Date(now.getTime() + set.seconds * 1000).toISOString();
	set.done = false;
}

function clearTimer(set: ActiveSet): void {
	delete set.timerEndsAt;
	delete set.timerDuration;
}

/** Stop before zero: the elapsed time is saved and the set is marked as done. */
export function stopTimer(set: ActiveSet, now: Date): void {
	if (!isTimerRunning(set) || !('seconds' in set)) return;
	const duration = set.timerDuration ?? set.seconds;
	set.seconds = Math.max(0, Math.round(duration - remainingMs(set, now) / 1000));
	set.done = true;
	clearTimer(set);
}

/** Cancels without touching the time or the done flag. */
export function cancelTimer(set: ActiveSet): void {
	clearTimer(set);
}

/**
 * Fills in the reached time for timers that hit zero, even if that happened
 * while the page was closed. Returns the number of sets that became done.
 */
export function completeExpiredTimers(session: ActiveSession, now: Date): number {
	let completed = 0;
	for (const ex of session.exercises) {
		for (const set of ex.sets) {
			if (!isTimerRunning(set) || remainingMs(set, now) > 0 || !('seconds' in set)) continue;
			set.seconds = set.timerDuration ?? set.seconds;
			set.done = true;
			clearTimer(set);
			completed++;
		}
	}
	return completed;
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
	const fresh = { exerciseId: to.id, sets: prefillSets(to, Math.max(old.sets.length, 1), target) };
	const done = old.sets.filter((s) => s.done);
	if (done.length) {
		old.sets = done;
		session.exercises.splice(index + 1, 0, fresh);
	} else {
		session.exercises.splice(index, 1, fresh);
	}

	const earlier = session.deviations.findIndex((d) => d.type === 'swap' && d.to === fromId);
	if (earlier < 0) session.deviations.push({ type: 'swap', from: fromId, to: to.id });
	else if (session.deviations[earlier].from === to.id) session.deviations.splice(earlier, 1);
	else session.deviations[earlier] = { type: 'swap', from: session.deviations[earlier].from, to: to.id };
}
