/**
 * History is computed from the exercise logs and session records; nothing is
 * stored separately.
 */
import { normalizeName, type Exercise, type ExerciseSet, type ExerciseType, type SessionRecord } from '$lib/model';
import { volume } from '$lib/session/active';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Estimated 1RM (Epley): weight × (1 + reps / 30). */
export function estimated1RM(weight: number, reps: number): number {
	return reps > 0 ? round1(weight * (1 + reps / 30)) : 0;
}

/** What "best set" is measured in per exercise type. */
export function metricFor(type: ExerciseType): { label: string; unit: string } {
	if (type === 'weight') return { label: 'Beräknad 1RM', unit: 'kg' };
	if (type === 'time') return { label: 'Längsta set', unit: 's' };
	return { label: 'Flest reps', unit: 'reps' };
}

/** Best set in a log entry: highest 1RM, most reps or longest time. */
export function bestSet(type: ExerciseType, sets: readonly ExerciseSet[]): { value: number; set: ExerciseSet } | null {
	let best: { value: number; set: ExerciseSet } | null = null;
	for (const set of sets) {
		const value =
			type === 'weight' && 'weight' in set
				? estimated1RM(set.weight, set.reps)
				: type === 'time' && 'seconds' in set
					? set.seconds
					: 'reps' in set
						? set.reps
						: 0;
		if (!best || value > best.value) best = { value, set };
	}
	return best && best.value > 0 ? best : null;
}

export interface SeriesPoint {
	date: string;
	value: number;
	set: ExerciseSet;
}

/** Best value per date, oldest first (several sessions on one day are merged). */
export function progressSeries(exercise: Exercise): SeriesPoint[] {
	const byDate = new Map<string, SeriesPoint>();
	for (const entry of exercise.log) {
		const best = bestSet(exercise.type, entry.sets);
		if (!best) continue;
		const prev = byDate.get(entry.date);
		if (!prev || best.value > prev.value) byDate.set(entry.date, { date: entry.date, ...best });
	}
	return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Best value ever, optionally excluding a given session. */
export function bestEver(exercise: Exercise, excludeSessionId?: string): number | null {
	let best: number | null = null;
	for (const entry of exercise.log) {
		if (excludeSessionId && entry.sessionId === excludeSessionId) continue;
		const b = bestSet(exercise.type, entry.sets);
		if (b && (best === null || b.value > best)) best = b.value;
	}
	return best;
}

/** Heaviest weight in a set with at least one rep (weight exercises only). */
export function heaviestWeight(type: ExerciseType, sets: readonly ExerciseSet[]): number | null {
	if (type !== 'weight') return null;
	let max = 0;
	for (const set of sets) if ('weight' in set && set.reps > 0 && set.weight > max) max = set.weight;
	return max > 0 ? max : null;
}

/** Heaviest weight ever, optionally excluding a given session. */
export function heaviestEver(exercise: Exercise, excludeSessionId?: string): number | null {
	let max: number | null = null;
	for (const entry of exercise.log) {
		if (excludeSessionId && entry.sessionId === excludeSessionId) continue;
		const h = heaviestWeight(exercise.type, entry.sets);
		if (h !== null && (max === null || h > max)) max = h;
	}
	return max;
}

/** "best" = best set (1RM, reps or time), "heaviest" = heaviest weight. */
export type RecordKind = 'best' | 'heaviest';

/**
 * Log entries (indexes into the exercise log) that set a record: strictly
 * better than everything before. The very first entry is not a record.
 */
export function recordEntries(exercise: Exercise): Map<number, RecordKind[]> {
	const order = exercise.log.map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || b.i - a.i);
	const records = new Map<number, RecordKind[]>();
	const prev: Record<RecordKind, number | null> = { best: null, heaviest: null };
	for (const { e, i } of order) {
		const values: Record<RecordKind, number | null> = {
			best: bestSet(exercise.type, e.sets)?.value ?? null,
			heaviest: heaviestWeight(exercise.type, e.sets)
		};
		for (const kind of ['best', 'heaviest'] as const) {
			const v = values[kind];
			if (v === null) continue;
			const p = prev[kind];
			if (p !== null && v > p) records.set(i, [...(records.get(i) ?? []), kind]);
			if (p === null || v > p) prev[kind] = v;
		}
	}
	return records;
}

// --- week ---------------------------------------------------------------

const DAY = 86_400_000;
const toDate = (d: string) => new Date(`${d}T12:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** A real YYYY-MM-DD date within reasonable years (e.g. not 2026-02-30). */
export function isValidDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const year = Number(date.slice(0, 4));
	const d = toDate(date);
	return year >= 2000 && year <= 2100 && !Number.isNaN(d.getTime()) && fmt(d) === date;
}

export function addDays(date: string, days: number): string {
	return fmt(new Date(toDate(date).getTime() + days * DAY));
}

/** Monday of the date's week (Swedish week, Monday–Sunday). */
export function weekStartOf(date: string): string {
	const weekday = (toDate(date).getUTCDay() + 6) % 7; // 0 = Monday
	return addDays(date, -weekday);
}

/** ISO week number. */
export function isoWeek(date: string): number {
	const d = toDate(weekStartOf(date));
	const thursday = new Date(d.getTime() + 3 * DAY);
	const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
	return 1 + Math.round((thursday.getTime() - toDate(weekStartOf(fmt(jan4))).getTime()) / (7 * DAY));
}

export interface WeekDay {
	date: string;
	trained: boolean;
}

export interface WeekSummary {
	start: string;
	week: number;
	days: WeekDay[];
	/** Saved sessions, plus imported training days without a session record. */
	sessionCount: number;
	volumeByType: Record<ExerciseType, number>;
}

export function weekSummary(start: string, exercises: readonly Exercise[], sessions: readonly SessionRecord[]): WeekSummary {
	const end = addDays(start, 7);
	const inWeek = (d: string) => d >= start && d < end;

	const sessionDates = sessions.map((s) => s.startedAt.slice(0, 10)).filter(inWeek);
	const trained = new Set(sessionDates);
	const importOnly = new Set<string>();
	const volumeByType: Record<ExerciseType, number> = { weight: 0, bodyweight: 0, time: 0 };

	for (const ex of exercises) {
		for (const entry of ex.log) {
			if (!inWeek(entry.date)) continue;
			trained.add(entry.date);
			if (!entry.sessionId && !sessionDates.includes(entry.date)) importOnly.add(entry.date);
			volumeByType[ex.type] = round1(volumeByType[ex.type] + volume(ex.type, entry.sets));
		}
	}

	return {
		start,
		week: isoWeek(start),
		days: Array.from({ length: 7 }, (_, i) => {
			const date = addDays(start, i);
			return { date, trained: trained.has(date) };
		}),
		sessionCount: sessionDates.length + importOnly.size,
		volumeByType
	};
}

// --- milestones ---------------------------------------------------------

/**
 * `match` is the goal itself. `progression` are exercises on the way there,
 * shown until the goal exercise has been logged.
 */
export const MILESTONES = [
	{
		key: 'pullup',
		title: 'Pull-up',
		match: /^(pull[\s-]?ups?|chins?[\s-]?ups?)$/,
		// Not exercises that merely use the bar, e.g. "Dead hang i pull-up-stång".
		progression: /(pull[\s-]?ups?|chins?[\s-]?ups?)(?![\s-]?(stång|bar))/
	},
	{
		key: 'handstand',
		title: 'Handstående',
		match: /^(handstående|handstand)/,
		progression: /(handstående|handstand|huvudstående|headstand|wall[\s-]?walk)/
	}
] as const;

const lastDate = (e: Exercise) => e.log.reduce((d, l) => (l.date > d ? l.date : d), '');
/** Most recently trained first, archived last. */
const byRecent = (a: Exercise, b: Exercise) => Number(a.archived) - Number(b.archived) || lastDate(b).localeCompare(lastDate(a));

/**
 * The exercise shown per milestone. If a goal exercise has history, it is
 * shown (most recently trained, archived only if there is no other).
 * Otherwise the most recently trained progression exercise is shown and
 * `progress` is true. `others` are the remaining progression exercises with
 * history.
 */
export function milestoneExercises(exercises: readonly Exercise[]) {
	return MILESTONES.map((m) => {
		const goals = exercises.filter((e) => m.match.test(normalizeName(e.name))).sort(byRecent);
		const steps = exercises
			.filter((e) => e.log.length && !m.match.test(normalizeName(e.name)) && m.progression.test(normalizeName(e.name)))
			.sort(byRecent);
		const goal = goals.find((e) => e.log.length) ?? null;
		const exercise = goal ?? steps[0] ?? goals[0] ?? null;
		const progress = !goal && exercise !== null && steps.includes(exercise);
		return {
			...m,
			exercise,
			progress,
			others: steps.filter((e) => e !== exercise)
		};
	});
}

// --- exercise list --------------------------------------------------------

/**
 * Groups exercises by workout, in each workout's own order, workouts sorted
 * by name. An exercise in several workouts shows under the first one only;
 * exercises in no workout go under "Övrigt". Archived exercises are left out
 * (the history page lists them separately).
 */
export function groupByWorkout<T extends { id: string; archived: boolean }>(
	exercises: readonly T[],
	workouts: readonly { name: string; exercises: readonly { exerciseId: string }[] }[]
): { name: string; exercises: T[] }[] {
	const left = new Map(exercises.filter((e) => !e.archived).map((e) => [e.id, e]));
	const groups: { name: string; exercises: T[] }[] = [];
	for (const w of [...workouts].sort((a, b) => a.name.localeCompare(b.name, 'sv'))) {
		const items = w.exercises.map((we) => left.get(we.exerciseId)).filter((e) => e !== undefined);
		for (const e of items) left.delete(e.id);
		if (items.length) groups.push({ name: w.name, exercises: items });
	}
	if (left.size) groups.push({ name: 'Övrigt', exercises: [...left.values()] });
	return groups;
}
