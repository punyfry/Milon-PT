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

/** Tyngsta vikten i ett set med minst en rep (bara viktövningar). */
export function heaviestWeight(type: ExerciseType, sets: readonly ExerciseSet[]): number | null {
	if (type !== 'weight') return null;
	let max = 0;
	for (const set of sets) if ('weight' in set && set.reps > 0 && set.weight > max) max = set.weight;
	return max > 0 ? max : null;
}

/** Tyngsta vikten någonsin, valfritt utan ett visst pass. */
export function heaviestEver(exercise: Exercise, excludeSessionId?: string): number | null {
	let max: number | null = null;
	for (const entry of exercise.log) {
		if (excludeSessionId && entry.sessionId === excludeSessionId) continue;
		const h = heaviestWeight(exercise.type, entry.sets);
		if (h !== null && (max === null || h > max)) max = h;
	}
	return max;
}

/** "best" = bästa set (1RM, reps eller tid), "heaviest" = tyngsta vikt. */
export type RecordKind = 'best' | 'heaviest';

/**
 * Loggposterna (index i övningens logg) som satte rekord: strikt bättre än
 * allt tidigare. Den allra första posten räknas inte som rekord.
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

// --- vecka --------------------------------------------------------------

const DAY = 86_400_000;
const toDate = (d: string) => new Date(`${d}T12:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Ett riktigt datum YYYY-MM-DD inom rimliga år (t.ex. inte 2026-02-30). */
export function isValidDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const year = Number(date.slice(0, 4));
	const d = toDate(date);
	return year >= 2000 && year <= 2100 && !Number.isNaN(d.getTime()) && fmt(d) === date;
}

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

/**
 * `match` är själva målet. `progression` är övningar på vägen dit, som visas
 * tills målövningen har loggats.
 */
export const MILESTONES = [
	{
		key: 'pullup',
		title: 'Pull-up',
		match: /^(pull[\s-]?ups?|chins?[\s-]?ups?)$/,
		progression: /(pull[\s-]?ups?|chins?[\s-]?ups?)/
	},
	{
		key: 'handstand',
		title: 'Handstående',
		match: /^(handstående|handstand)/,
		progression: /(handstående|handstand|huvudstående|headstand|wall[\s-]?walk)/
	}
] as const;

const lastDate = (e: Exercise) => e.log.reduce((d, l) => (l.date > d ? l.date : d), '');
/** Senast tränade först, arkiverade sist. */
const byRecent = (a: Exercise, b: Exercise) => Number(a.archived) - Number(b.archived) || lastDate(b).localeCompare(lastDate(a));

/**
 * Övningen som visas per milstolpe. Finns en målövning med historik visas
 * den (senast tränade, arkiverad bara om ingen annan finns). Annars visas
 * den senast tränade progressionsövningen, och `progress` blir true.
 * `others` är övriga progressionsövningar med historik.
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
