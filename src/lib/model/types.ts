/**
 * Datamodellen enligt SPEC.md. Delas av server och klient.
 *
 * Per användare finns fyra filtyper under `users/<userId>/`:
 * - `profile.json`
 * - `exercises/<exerciseId>.json`
 * - `workouts/<slug>.v<N>.json`
 * - `sessions/<sessionId>.json`
 */

export type ExerciseType = 'weight' | 'bodyweight' | 'time';

/** `light` = steg 1,25 kg, `heavy` = steg 5 kg. Gäller bara `weight`. */
export type LoadClass = 'light' | 'heavy';

export interface WeightSet {
	weight: number;
	reps: number;
}
export interface RepsSet {
	reps: number;
}
export interface TimeSet {
	seconds: number;
}
export type ExerciseSet = WeightSet | RepsSet | TimeSet;

export interface LogEntry {
	/** Saknas för poster som importerats utan pass. */
	sessionId?: string;
	/** YYYY-MM-DD */
	date: string;
	sets: ExerciseSet[];
	/** Fri anteckning, t.ex. "Nästa gång: prova 25 kg". */
	note?: string;
}

export interface Exercise {
	id: string;
	name: string;
	type: ExerciseType;
	/** Finns bara när `type` är `weight`. */
	loadClass?: LoadClass;
	instruction: string;
	archived: boolean;
	/** Nyaste post först. "Förra gången" är `log[0]`. */
	log: LogEntry[];
}

export type Target = { reps: number } | { seconds: number };

export interface WorkoutExercise {
	exerciseId: string;
	sets: number;
	target: Target;
}

export interface WorkoutTemplate {
	slug: string;
	name: string;
	version: number;
	/** YYYY-MM-DD */
	createdAt: string;
	changeNote?: string;
	exercises: WorkoutExercise[];
}

export interface SwapDeviation {
	type: 'swap';
	from: string;
	to: string;
}
export type Deviation = SwapDeviation;

export interface SessionRecord {
	id: string;
	workoutSlug: string;
	workoutVersion: number;
	/** ISO 8601 med tidszon */
	startedAt: string;
	endedAt: string;
	exerciseIds: string[];
	deviations: Deviation[];
	kcalEstimate?: number;
}

export type KcalWorkoutType = 'strength' | 'hiit';
export interface KcalRange {
	min: number;
	max: number;
}

export interface Profile {
	/** Fritext om mål. */
	goals?: string;
	/** Antal pass per vecka, för veckovyn. */
	weeklySessionGoal?: number;
	/** Träningsregler som coachen ska känna till. */
	rules?: string[];
	/** kcal-uppskattning per pass, nyckel = workout-slug. Går före kcalEstimates. */
	kcalPerWorkout?: Record<string, number>;
	/** kcal-uppskattning per passtyp (SPEC.md: styrka ca 250–350, HIIT ca 300–450). */
	kcalEstimates?: Partial<Record<KcalWorkoutType, KcalRange>>;
	/** Övrig kontext till coachen. */
	coachContext?: string;
}

/**
 * Ett set i det pågående passet. För tidsövningar kan en timer gå: den
 * lagrar sluttidpunkten (inte ett intervall), så den stämmer även om skärmen
 * låses eller fliken byts.
 */
export type ActiveSet = ExerciseSet & {
	done: boolean;
	/** ISO-tid när nedräkningen når noll. Finns bara medan timern går. */
	timerEndsAt?: string;
	/** Nedräkningens längd i sekunder, för att räkna ut tiden vid tidig stopp. */
	timerDuration?: number;
};

/** Pågående pass i localStorage under nyckeln `milonpt.activeSession`. */
export interface ActiveSession {
	sessionId: string;
	workoutSlug: string;
	workoutVersion: number;
	startedAt: string;
	lastActivityAt: string;
	exercises: { exerciseId: string; sets: ActiveSet[] }[];
	deviations: Deviation[];
}

export const ACTIVE_SESSION_KEY = 'milonpt.activeSession';

export const LOAD_STEP_KG: Record<LoadClass, number> = { light: 1.25, heavy: 5 };
/** Föreslaget steg för tidsövningar (öppet beslut i SPEC.md). */
export const TIME_STEP_SECONDS = 5;
