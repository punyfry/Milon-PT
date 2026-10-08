/**
 * The data model (see README.md). Shared by server and client.
 *
 * Each user has four file types under `users/<userId>/`:
 * - `profile.json`
 * - `exercises/<exerciseId>.json`
 * - `workouts/<slug>.v<N>.json`
 * - `sessions/<sessionId>.json`
 */

export type ExerciseType = 'weight' | 'bodyweight' | 'time';

/** `light` = 1.25 kg steps, `heavy` = 5 kg steps. Only for `weight`. */
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
	/** Missing for entries imported without a session. */
	sessionId?: string;
	/** YYYY-MM-DD */
	date: string;
	sets: ExerciseSet[];
	/** Free-text note, e.g. "Nästa gång: prova 25 kg". */
	note?: string;
}

export interface Exercise {
	id: string;
	name: string;
	type: ExerciseType;
	/** Only present when `type` is `weight`. */
	loadClass?: LoadClass;
	instruction: string;
	archived: boolean;
	/** Newest entry first. "Last time" is `log[0]`. */
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
	/** ISO 8601 with time zone */
	startedAt: string;
	endedAt: string;
	exerciseIds: string[];
	deviations: Deviation[];
	kcalEstimate?: number;
	/**
	 * The start time it was saved with, kept when the start is edited
	 * afterwards: a queued retry of the save still sends that value and must be
	 * recognised as already saved.
	 */
	originalStartedAt?: string;
}

export type KcalWorkoutType = 'strength' | 'hiit';
export interface KcalRange {
	min: number;
	max: number;
}

export interface Profile {
	/** Free-text goals. */
	goals?: string;
	/** Sessions per week, for the week view. */
	weeklySessionGoal?: number;
	/** Training rules the coach should know about. */
	rules?: string[];
	/** kcal estimate per workout, keyed by workout slug. Takes precedence over kcalEstimates. */
	kcalPerWorkout?: Record<string, number>;
	/** kcal estimate per workout type (default: strength ~250–350, HIIT ~300–450). */
	kcalEstimates?: Partial<Record<KcalWorkoutType, KcalRange>>;
	/** Other context for the coach. */
	coachContext?: string;
}

/**
 * A set in the active session. Timed exercises can run a timer: it stores
 * the end time (not an interval), so it stays correct if the screen locks
 * or the tab changes.
 */
export type ActiveSet = ExerciseSet & {
	done: boolean;
	/** ISO time when the countdown reaches zero. Only present while the timer runs. */
	timerEndsAt?: string;
	/** Countdown length in seconds, to compute the time on an early stop. */
	timerDuration?: number;
	/**
	 * Planned time in seconds, kept after an early stop so that starting the
	 * timer again counts down from it rather than from the reached time.
	 * Cleared when the time is changed by hand.
	 */
	plannedSeconds?: number;
};

/** Active session in localStorage under the key `milonpt.activeSession`. */
export interface ActiveSession {
	sessionId: string;
	workoutSlug: string;
	workoutVersion: number;
	startedAt: string;
	lastActivityAt: string;
	/** `note` is the user's note for the exercise today, saved with its log entry. */
	exercises: { exerciseId: string; sets: ActiveSet[]; note?: string }[];
	deviations: Deviation[];
	/** Index of the exercise shown, so a paused workout resumes where it was. */
	current?: number;
	/**
	 * Not started yet: the overview before the workout, where exercises can be
	 * swapped. `startedAt` and `sessionId` are set again when it starts.
	 */
	preparing?: boolean;
}

/** Longest note per exercise and session (log entry, active session, editor). */
export const NOTE_MAX = 1000;

export const ACTIVE_SESSION_KEY = 'milonpt.activeSession';

export const LOAD_STEP_KG: Record<LoadClass, number> = { light: 1.25, heavy: 5 };
/** Step for timed exercises (±5 s). */
export const TIME_STEP_SECONDS = 5;
