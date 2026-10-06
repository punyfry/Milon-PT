/**
 * Logik för det pågående passet. Rena funktioner som ändrar objekten de får,
 * så att de fungerar direkt på Svelte-state och går att testa utan DOM.
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
	type Target,
	type WorkoutTemplate
} from '$lib/model';

/** Det klienten behöver veta om en övning under passet. Bara senaste loggposten, aldrig hela loggen. */
export interface ExerciseInfo {
	id: string;
	name: string;
	type: ExerciseType;
	loadClass?: LoadClass;
	instruction: string;
	lastEntry?: LogEntry;
}

// --- tid ----------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Lokal tid som ISO 8601 med tidszon, t.ex. "2026-10-06T17:10:00+02:00". */
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

/** Datumdelen av en lokal ISO-tid: "2026-10-06T17:10:00+02:00" → "2026-10-06". */
export function localDateOf(iso: string): string {
	return iso.slice(0, 10);
}

// --- start --------------------------------------------------------------

function defaultSet(type: ExerciseType, target?: Target): ExerciseSet {
	if (type === 'time') return { seconds: target && 'seconds' in target ? target.seconds : 30 };
	const reps = target && 'reps' in target ? target.reps : 8;
	return type === 'weight' ? { weight: 0, reps } : { reps };
}

/** Plockar ut setvärdena utan extra fält (som `done` eller timerfält). */
function setValues(type: ExerciseType, set: ExerciseSet): ExerciseSet {
	if (type === 'weight' && 'weight' in set) return { weight: set.weight, reps: set.reps };
	if (type === 'time' && 'seconds' in set) return { seconds: set.seconds };
	if (type === 'bodyweight' && 'reps' in set) return { reps: set.reps };
	return defaultSet(type);
}

/**
 * Förifyller seten från övningens senaste loggpost, annars från passmallens
 * mål. Antalet set följer mallen; har förra gången färre set upprepas det
 * sista.
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

// --- ändringar ----------------------------------------------------------

export type SetField = 'weight' | 'reps' | 'seconds';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function stepFor(field: SetField, loadClass?: LoadClass): number {
	if (field === 'weight') return LOAD_STEP_KG[loadClass ?? 'light'];
	if (field === 'seconds') return TIME_STEP_SECONDS;
	return 1;
}

/** −/+ på ett fält. Aldrig under noll. */
export function adjust(set: ActiveSet, field: SetField, direction: 1 | -1, loadClass?: LoadClass): void {
	const values = set as unknown as Partial<Record<SetField, number>>;
	const current = values[field];
	if (current === undefined) return;
	values[field] = Math.max(0, round2(current + direction * stepFor(field, loadClass)));
}

/** Sätter ett fält till ett inskrivet värde. Ogiltiga värden ignoreras. */
export function setField(set: ActiveSet, field: SetField, value: number): void {
	const values = set as unknown as Partial<Record<SetField, number>>;
	if (values[field] === undefined || !Number.isFinite(value) || value < 0) return;
	values[field] = field === 'weight' ? round2(value) : Math.round(value);
}

/** Nytt set med samma värden som det sista, inte markerat som klart. */
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

/** Startar nedräkningen från setets nuvarande tid. */
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

/** Stopp före noll: den tid som gått sparas och setet markeras som klart. */
export function stopTimer(set: ActiveSet, now: Date): void {
	if (!isTimerRunning(set) || !('seconds' in set)) return;
	const duration = set.timerDuration ?? set.seconds;
	set.seconds = Math.max(0, Math.round(duration - remainingMs(set, now) / 1000));
	set.done = true;
	clearTimer(set);
}

/** Avbryter utan att röra tiden eller klar-markeringen. */
export function cancelTimer(set: ActiveSet): void {
	clearTimer(set);
}

/**
 * Fyller i uppnådd tid för timers som nått noll, även om det hände medan
 * sidan var stängd. Returnerar antalet set som blev klara.
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

// --- sammanfattning -----------------------------------------------------

/**
 * Volym enligt SPEC.md: weight = summa vikt × reps, bodyweight = summa reps,
 * time = summa sekunder.
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
	/** Total volym per övningstyp (kg, reps, sekunder). */
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

/** Förslag enligt SPEC.md: styrka ca 250–350 kcal. Profilens värde för passet går före. */
export const DEFAULT_KCAL = 300;
