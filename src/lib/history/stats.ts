/**
 * Historiken räknas ut ur övningsloggarna och sessionsposterna; inget lagras
 * separat (SPEC.md, "Historik och import").
 */
import { normalizeName, type Exercise, type ExerciseSet, type ExerciseType, type SessionRecord } from '$lib/model';
import { volume } from '$lib/session/active';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Beräknad 1RM enligt SPEC.md: vikt × (1 + reps / 30). */
export function estimated1RM(weight: number, reps: number): number {
	return reps > 0 ? round1(weight * (1 + reps / 30)) : 0;
}

/** Vad "bästa set" mäts i per övningstyp. */
export function metricFor(type: ExerciseType): { label: string; unit: string } {
	if (type === 'weight') return { label: 'Beräknad 1RM', unit: 'kg' };
	if (type === 'time') return { label: 'Längsta set', unit: 's' };
	return { label: 'Flest reps', unit: 'reps' };
}

/** Bästa setet i en loggpost: högst 1RM, flest reps eller längst tid. */
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

/** Bästa värdet per datum, äldst först (flera pass samma dag slås ihop). */
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

/** Bästa värdet någonsin, valfritt utan ett visst pass. */
export function bestEver(exercise: Exercise, excludeSessionId?: string): number | null {
	let best: number | null = null;
	for (const entry of exercise.log) {
		if (excludeSessionId && entry.sessionId === excludeSessionId) continue;
		const b = bestSet(exercise.type, entry.sets);
		if (b && (best === null || b.value > best)) best = b.value;
	}
	return best;
}

/**
 * Loggpostens index (i övningens logg) som satte rekord: bättre än allt
 * tidigare. Den allra första posten räknas inte som rekord.
 */
export function recordEntries(exercise: Exercise): Set<number> {
	const order = exercise.log.map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || b.i - a.i);
	const records = new Set<number>();
	let best: number | null = null;
	for (const { e, i } of order) {
		const b = bestSet(exercise.type, e.sets);
		if (!b) continue;
		if (best !== null && b.value > best) records.add(i);
		if (best === null || b.value > best) best = b.value;
	}
	return records;
}

// --- vecka --------------------------------------------------------------

const DAY = 86_400_000;
const toDate = (d: string) => new Date(`${d}T12:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
	return fmt(new Date(toDate(date).getTime() + days * DAY));
}

/** Måndagen i datumets vecka (svensk vecka, måndag–söndag). */
export function weekStartOf(date: string): string {
	const weekday = (toDate(date).getUTCDay() + 6) % 7; // 0 = måndag
	return addDays(date, -weekday);
}

/** ISO-veckonummer. */
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
	/** Sparade pass, plus importerade träningsdagar utan sessionspost. */
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

// --- milstolpar ---------------------------------------------------------

export const MILESTONES = [
	{ key: 'pullup', title: 'Pull-up', match: /^(pull[\s-]?ups?|chins?[\s-]?ups?)$/ },
	{ key: 'handstand', title: 'Handstående', match: /^(handstående|handstand)/ }
] as const;

/** Övningarna som räknas som milstolpar (Pull-up i reps, handstående i sekunder). */
export function milestoneExercises(exercises: readonly Exercise[]) {
	return MILESTONES.map((m) => ({
		...m,
		exercise: exercises.find((e) => m.match.test(normalizeName(e.name))) ?? null
	}));
}
