import type {
	Deviation,
	Exercise,
	ExerciseSet,
	ExerciseType,
	LogEntry,
	Profile,
	SessionRecord,
	Target,
	WorkoutExercise,
	WorkoutTemplate
} from './types';
import { NOTE_MAX } from './types';

/**
 * Hand-written validators for the data model. Each validator collects issues
 * with a path (e.g. `exercises[2].log[0].sets[1].reps`) instead of stopping at
 * the first, so an import file can be fixed in one go.
 */
export class Issues {
	readonly list: string[] = [];
	add(path: string, message: string) {
		this.list.push(path ? `${path}: ${message}` : message);
	}
	get ok() {
		return this.list.length === 0;
	}
}

export class ValidationError extends Error {
	constructor(
		readonly what: string,
		readonly issues: string[]
	) {
		super(`Ogiltig ${what}:\n  - ${issues.join('\n  - ')}`);
		this.name = 'ValidationError';
	}
}

/** Runs a validator and throws `ValidationError` on any issue. */
export function assertValid<T>(
	what: string,
	value: unknown,
	validator: (v: unknown, issues: Issues, path: string) => T | null
): T {
	const issues = new Issues();
	const result = validator(value, issues, '');
	if (!issues.ok || result === null) throw new ValidationError(what, issues.list);
	return result;
}

// --- primitives ---------------------------------------------------------

type Obj = Record<string, unknown>;

export function isObject(v: unknown): v is Obj {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function join(path: string, key: string | number): string {
	return typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key;
}

function str(o: Obj, key: string, issues: Issues, path: string, opts: { optional?: boolean; allowEmpty?: boolean } = {}): string | undefined {
	const v = o[key];
	if (v === undefined && opts.optional) return undefined;
	if (typeof v !== 'string' || (!opts.allowEmpty && v.trim() === '')) {
		issues.add(join(path, key), opts.allowEmpty ? 'måste vara en sträng' : 'måste vara en icke-tom sträng');
		return undefined;
	}
	return v;
}

function num(o: Obj, key: string, issues: Issues, path: string, opts: { int?: boolean; min?: number; optional?: boolean } = {}): number | undefined {
	const v = o[key];
	if (v === undefined && opts.optional) return undefined;
	if (typeof v !== 'number' || !Number.isFinite(v)) {
		issues.add(join(path, key), 'måste vara ett tal');
		return undefined;
	}
	if (opts.int && !Number.isInteger(v)) issues.add(join(path, key), 'måste vara ett heltal');
	if (opts.min !== undefined && v < opts.min) issues.add(join(path, key), `måste vara minst ${opts.min}`);
	return v;
}

function arr(o: Obj, key: string, issues: Issues, path: string): unknown[] | undefined {
	const v = o[key];
	if (!Array.isArray(v)) {
		issues.add(join(path, key), 'måste vara en lista');
		return undefined;
	}
	return v;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** Ids of exercises and sessions: also safe in a storage path. */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A YYYY-MM-DD date that exists in the calendar (not e.g. 2024-02-30). */
export function isCalendarDate(v: string): boolean {
	if (!DATE.test(v)) return false;
	const d = new Date(`${v}T12:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function date(o: Obj, key: string, issues: Issues, path: string): string | undefined {
	const v = str(o, key, issues, path);
	if (v === undefined) return undefined;
	if (!isCalendarDate(v)) issues.add(join(path, key), 'måste vara ett datum YYYY-MM-DD');
	return v;
}

function datetime(o: Obj, key: string, issues: Issues, path: string): string | undefined {
	const v = str(o, key, issues, path);
	if (v === undefined) return undefined;
	if (!DATETIME.test(v) || Number.isNaN(Date.parse(v))) issues.add(join(path, key), 'måste vara en ISO-tid med tidszon');
	return v;
}

function id(o: Obj, key: string, issues: Issues, path: string): string | undefined {
	const v = str(o, key, issues, path);
	if (v !== undefined && !SAFE_ID.test(v)) issues.add(join(path, key), 'får bara innehålla a-z, 0-9, _ och -');
	return v;
}

// --- the model -----------------------------------------------------------

export const EXERCISE_TYPES: readonly ExerciseType[] = ['weight', 'bodyweight', 'time'];

export function isExerciseType(v: unknown): v is ExerciseType {
	return EXERCISE_TYPES.includes(v as ExerciseType);
}

/** Validates a set against the exercise type and returns it without extra fields. */
export function validateSet(v: unknown, type: ExerciseType, issues: Issues, path: string): ExerciseSet | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	let set: ExerciseSet | null = null;
	if (type === 'weight') {
		const weight = num(v, 'weight', issues, path, { min: 0 });
		const reps = num(v, 'reps', issues, path, { int: true, min: 0 });
		if (weight !== undefined && reps !== undefined) set = { weight, reps };
	} else if (type === 'bodyweight') {
		const reps = num(v, 'reps', issues, path, { int: true, min: 0 });
		if (reps !== undefined) set = { reps };
	} else {
		const seconds = num(v, 'seconds', issues, path, { int: true, min: 0 });
		if (seconds !== undefined) set = { seconds };
	}
	return issues.list.length === before ? set : null;
}

export function validateLogEntry(v: unknown, type: ExerciseType, issues: Issues, path: string): LogEntry | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const sessionId = v.sessionId === undefined ? undefined : id(v, 'sessionId', issues, path);
	const d = date(v, 'date', issues, path);
	const rawSets = arr(v, 'sets', issues, path) ?? [];
	const sets = rawSets.map((s, i) => validateSet(s, type, issues, join(join(path, 'sets'), i)));
	const note = str(v, 'note', issues, path, { optional: true, allowEmpty: true })?.trim();
	if (note && note.length > NOTE_MAX) issues.add(join(path, 'note'), `får vara högst ${NOTE_MAX} tecken`);
	if (issues.list.length !== before || d === undefined) return null;
	return { ...(sessionId ? { sessionId } : {}), date: d, sets: sets as ExerciseSet[], ...(note ? { note } : {}) };
}

export function validateExercise(v: unknown, issues: Issues, path: string): Exercise | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const exId = id(v, 'id', issues, path);
	const name = str(v, 'name', issues, path);
	const type = v.type;
	if (!isExerciseType(type)) {
		issues.add(join(path, 'type'), `måste vara ${EXERCISE_TYPES.join(', ')}`);
		return null;
	}
	// `loadClass` (weight steps) and `archived` are no longer used; they are dropped from older files when
	// they are read, so archived exercises become active (#46).
	const instruction = str(v, 'instruction', issues, path, { allowEmpty: true });
	if (v.deleted !== undefined && typeof v.deleted !== 'boolean') issues.add(join(path, 'deleted'), 'måste vara true eller false');
	const note = validateExerciseNote(v.note, issues, join(path, 'note'));
	const log = (arr(v, 'log', issues, path) ?? []).map((e, i) =>
		validateLogEntry(e, type, issues, join(join(path, 'log'), i))
	);
	if (issues.list.length !== before) return null;
	return {
		id: exId!,
		name: name!,
		type,
		instruction: instruction!,
		...(note ? { note } : {}),
		...(v.deleted === true ? { deleted: true as const } : {}),
		log: log as LogEntry[]
	};
}

/** An issue as a sentence for the user: "name: övningen behöver ett namn" → "Övningen behöver ett namn." */
export function issueText(issue: string): string {
	const text = issue.replace(/^[\w.[\]]+: /, '');
	return text[0].toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
}

export const MAX_EXERCISE_NAME = 80;
export const MAX_INSTRUCTION = 1000;

/** Name, type and instruction of an exercise written in by the user, trimmed. */
export function validateExerciseInput(
	v: unknown,
	issues: Issues,
	path: string
): Pick<Exercise, 'name' | 'type' | 'instruction'> | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const raw = typeof v.name === 'string' ? v.name.trim() : '';
	const name = raw.replace(/\s+/g, ' ');
	if (!name) issues.add(join(path, 'name'), 'övningen behöver ett namn');
	// The length is checked before spaces are collapsed, so the input itself stays small.
	else if (raw.length > MAX_EXERCISE_NAME) issues.add(join(path, 'name'), `namnet får vara högst ${MAX_EXERCISE_NAME} tecken`);
	if (!isExerciseType(v.type)) issues.add(join(path, 'type'), `måste vara ${EXERCISE_TYPES.join(', ')}`);
	if (v.instruction !== undefined && typeof v.instruction !== 'string') issues.add(join(path, 'instruction'), 'måste vara en sträng');
	const instruction = typeof v.instruction === 'string' ? v.instruction.trim() : '';
	if (instruction.length > MAX_INSTRUCTION) issues.add(join(path, 'instruction'), `får vara högst ${MAX_INSTRUCTION} tecken`);
	if (issues.list.length !== before) return null;
	return { name, type: v.type as ExerciseType, instruction };
}

/** An exercise's own note (`Exercise.note`): optional text, trimmed, empty means none. */
export function validateExerciseNote(v: unknown, issues: Issues, path: string): string {
	if (v === undefined || v === null) return '';
	if (typeof v !== 'string') {
		issues.add(path, 'måste vara text');
		return '';
	}
	const note = v.trim();
	if (note.length > NOTE_MAX) issues.add(path, `får vara högst ${NOTE_MAX} tecken`);
	return note;
}

export function validateTarget(v: unknown, issues: Issues, path: string): Target | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	if ('reps' in v && 'seconds' in v) {
		issues.add(path, 'ange antingen reps eller seconds, inte båda');
		return null;
	}
	if ('seconds' in v) {
		const seconds = num(v, 'seconds', issues, path, { int: true, min: 1 });
		return seconds === undefined ? null : { seconds };
	}
	const reps = num(v, 'reps', issues, path, { int: true, min: 1 });
	return reps === undefined ? null : { reps };
}

/** Target in reps for weight/bodyweight, seconds for time. */
export function targetMatchesType(target: Target, type: ExerciseType): boolean {
	return type === 'time' ? 'seconds' in target : 'reps' in target;
}

export function validateWorkoutExercise(v: unknown, issues: Issues, path: string): WorkoutExercise | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const exerciseId = id(v, 'exerciseId', issues, path);
	const sets = num(v, 'sets', issues, path, { int: true, min: 1 });
	const target = validateTarget(v.target, issues, join(path, 'target'));
	if (issues.list.length !== before || !target) return null;
	return { exerciseId: exerciseId!, sets: sets!, target };
}

export function validateWorkout(v: unknown, issues: Issues, path: string): WorkoutTemplate | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const slug = str(v, 'slug', issues, path);
	if (slug !== undefined && !SLUG.test(slug)) issues.add(join(path, 'slug'), 'får bara innehålla a-z, 0-9 och -');
	const name = str(v, 'name', issues, path);
	const version = num(v, 'version', issues, path, { int: true, min: 1 });
	const createdAt = date(v, 'createdAt', issues, path);
	const changeNote = str(v, 'changeNote', issues, path, { optional: true, allowEmpty: true });
	const exercises = (arr(v, 'exercises', issues, path) ?? []).map((e, i) =>
		validateWorkoutExercise(e, issues, join(join(path, 'exercises'), i))
	);
	if (issues.list.length !== before) return null;
	return {
		slug: slug!,
		name: name!,
		version: version!,
		createdAt: createdAt!,
		...(changeNote !== undefined ? { changeNote } : {}),
		exercises: exercises as WorkoutExercise[]
	};
}

function validateDeviation(v: unknown, issues: Issues, path: string): Deviation | null {
	if (!isObject(v) || v.type !== 'swap') {
		issues.add(path, 'okänd avvikelse (bara type "swap" stöds)');
		return null;
	}
	const before = issues.list.length;
	const from = id(v, 'from', issues, path);
	const to = id(v, 'to', issues, path);
	if (issues.list.length !== before) return null;
	return { type: 'swap', from: from!, to: to! };
}

export function validateSession(v: unknown, issues: Issues, path: string): SessionRecord | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const sId = id(v, 'id', issues, path);
	const workoutSlug = str(v, 'workoutSlug', issues, path);
	const workoutVersion = num(v, 'workoutVersion', issues, path, { int: true, min: 1 });
	const startedAt = datetime(v, 'startedAt', issues, path);
	const endedAt = datetime(v, 'endedAt', issues, path);
	const exerciseIds = (arr(v, 'exerciseIds', issues, path) ?? []).map((e, i) => {
		if (typeof e !== 'string' || !SAFE_ID.test(e)) issues.add(join(join(path, 'exerciseIds'), i), 'ogiltigt övnings-ID');
		return e as string;
	});
	const deviations = (arr(v, 'deviations', issues, path) ?? []).map((d, i) =>
		validateDeviation(d, issues, join(join(path, 'deviations'), i))
	);
	const kcalEstimate = num(v, 'kcalEstimate', issues, path, { min: 0, optional: true });
	const originalStartedAt = v.originalStartedAt === undefined ? undefined : datetime(v, 'originalStartedAt', issues, path);
	if (issues.list.length !== before) return null;
	return {
		id: sId!,
		workoutSlug: workoutSlug!,
		workoutVersion: workoutVersion!,
		startedAt: startedAt!,
		endedAt: endedAt!,
		exerciseIds,
		deviations: deviations as Deviation[],
		...(kcalEstimate !== undefined ? { kcalEstimate } : {}),
		...(originalStartedAt !== undefined ? { originalStartedAt } : {})
	};
}

export function validateProfile(v: unknown, issues: Issues, path: string): Profile | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const goals = str(v, 'goals', issues, path, { optional: true, allowEmpty: true });
	const weeklySessionGoal = num(v, 'weeklySessionGoal', issues, path, { int: true, min: 0, optional: true });
	const coachContext = str(v, 'coachContext', issues, path, { optional: true, allowEmpty: true });
	if (v.coach !== undefined && typeof v.coach !== 'boolean') issues.add(join(path, 'coach'), 'måste vara true eller false');
	let rules: string[] | undefined;
	if (v.rules !== undefined) {
		rules = (arr(v, 'rules', issues, path) ?? []).map((r, i) => {
			if (typeof r !== 'string') issues.add(join(join(path, 'rules'), i), 'måste vara en sträng');
			return r as string;
		});
	}
	let kcalPerWorkout: Record<string, number> | undefined;
	if (v.kcalPerWorkout !== undefined) {
		if (!isObject(v.kcalPerWorkout)) issues.add(join(path, 'kcalPerWorkout'), 'måste vara ett objekt');
		else {
			kcalPerWorkout = {};
			for (const k of Object.keys(v.kcalPerWorkout)) {
				const n = num(v.kcalPerWorkout, k, issues, join(path, 'kcalPerWorkout'), { min: 0 });
				if (n !== undefined) kcalPerWorkout[k] = n;
			}
		}
	}
	let kcalEstimates: Profile['kcalEstimates'];
	if (v.kcalEstimates !== undefined) {
		kcalEstimates = validateKcalEstimates(v.kcalEstimates, issues, join(path, 'kcalEstimates')) ?? undefined;
	}
	if (issues.list.length !== before) return null;
	return {
		...(kcalEstimates ? { kcalEstimates } : {}),
		...(goals !== undefined ? { goals } : {}),
		...(weeklySessionGoal !== undefined ? { weeklySessionGoal } : {}),
		...(rules ? { rules } : {}),
		...(kcalPerWorkout ? { kcalPerWorkout } : {}),
		...(coachContext !== undefined ? { coachContext } : {}),
		...(typeof v.coach === 'boolean' ? { coach: v.coach } : {})
	};
}

const KCAL_TYPES = ['strength', 'hiit'] as const;

/** { strength: { min, max }, hiit: { min, max } }, both optional. */
export function validateKcalEstimates(v: unknown, issues: Issues, path: string): Profile['kcalEstimates'] | null {
	if (!isObject(v)) {
		issues.add(path, 'måste vara ett objekt');
		return null;
	}
	const before = issues.list.length;
	const out: NonNullable<Profile['kcalEstimates']> = {};
	for (const key of Object.keys(v)) {
		const p = join(path, key);
		const range = v[key];
		if (!(KCAL_TYPES as readonly string[]).includes(key)) {
			issues.add(p, `okänd passtyp (${KCAL_TYPES.join(' eller ')})`);
			continue;
		}
		if (!isObject(range)) {
			issues.add(p, 'måste vara { min, max }');
			continue;
		}
		const min = num(range, 'min', issues, p, { min: 0 });
		const max = num(range, 'max', issues, p, { min: 0 });
		if (min !== undefined && max !== undefined) {
			if (min > max) issues.add(p, 'min får inte vara större än max');
			else out[key as (typeof KCAL_TYPES)[number]] = { min, max };
		}
	}
	return issues.list.length === before ? out : null;
}
