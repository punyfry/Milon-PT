/**
 * Saves a finished session: exercise logs, optionally a new workout version,
 * and finally the session record.
 *
 * Saving is idempotent: if it fails halfway and the client retries, log
 * entries already written (same sessionId) and an already created workout
 * version are skipped. The session record is written last and marks completion.
 */
import {
	Issues,
	MAX_NEW_EXERCISES,
	NEW_EXERCISE_ID,
	SAFE_ID,
	ValidationError,
	NOTE_MAX,
	isObject,
	sessionIdFor,
	targetMatchesType,
	validateExerciseInput,
	validateSet,
	type ActiveSession,
	type Deviation,
	type Exercise,
	type ExerciseSet,
	type NewSessionExercise,
	type SessionRecord,
	type Target,
	type WorkoutTemplate
} from '../../model';
import type { UserStorage } from '../storage/types';
import { findOrCreateExercise, getExercise, listExercises, prependLogEntry } from './exercises';
import { createSession, getSession, listSessionIds } from './sessions';
import { getLatestWorkout, getWorkout, saveWorkoutVersion } from './workouts';

export interface SaveSessionInput {
	session: ActiveSession;
	endedAt: string;
	kcalEstimate?: number;
	/** Save the deviations as a new version of the workout. */
	saveAsNewVersion: boolean;
}

export interface SaveSessionResult {
	sessionId: string;
	newWorkoutVersion?: number;
	alreadySaved: boolean;
}

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Basic check of an active session from the client (localStorage), before
 * anything is read from storage. Pushes errors to `issues` and returns the session.
 */
export function checkActiveSession(raw: unknown, issues: string[]): ActiveSession | null {
	if (!isObject(raw)) {
		issues.push('session saknas');
		return null;
	}
	const s = raw;
	if (typeof s.sessionId !== 'string' || !SAFE_ID.test(s.sessionId)) issues.push('session.sessionId är ogiltigt');
	if (typeof s.workoutSlug !== 'string' || !/^[a-z0-9-]+$/.test(s.workoutSlug)) issues.push('session.workoutSlug är ogiltig');
	if (typeof s.workoutVersion !== 'number' || !Number.isInteger(s.workoutVersion) || s.workoutVersion < 1)
		issues.push('session.workoutVersion är ogiltig');
	for (const key of ['startedAt', 'lastActivityAt'] as const) {
		if (typeof s[key] !== 'string' || !DATETIME.test(s[key] as string)) issues.push(`session.${key} är ogiltig`);
	}
	if (!Array.isArray(s.exercises)) issues.push('session.exercises måste vara en lista');
	else
		s.exercises.forEach((ex, i) => {
			if (!isObject(ex) || typeof ex.exerciseId !== 'string' || !SAFE_ID.test(ex.exerciseId) || !Array.isArray(ex.sets))
				issues.push(`session.exercises[${i}] är ogiltig`);
			else if (ex.note !== undefined && typeof ex.note !== 'string') issues.push(`session.exercises[${i}].note måste vara text`);
			else if (typeof ex.note === 'string' && ex.note.length > NOTE_MAX)
				issues.push(`session.exercises[${i}].note får vara högst ${NOTE_MAX} tecken`);
		});
	if (s.preparing !== undefined && typeof s.preparing !== 'boolean') issues.push('session.preparing är ogiltig');
	if (!Array.isArray(s.deviations)) issues.push('session.deviations måste vara en lista');
	else
		s.deviations.forEach((d, i) => {
			if (!isObject(d) || d.type !== 'swap' || typeof d.from !== 'string' || !SAFE_ID.test(d.from) || typeof d.to !== 'string' || !SAFE_ID.test(d.to))
				issues.push(`session.deviations[${i}] är ogiltig`);
		});
	if (s.newExercises !== undefined) {
		if (!Array.isArray(s.newExercises) || s.newExercises.length > MAX_NEW_EXERCISES)
			issues.push(`session.newExercises måste vara en lista med högst ${MAX_NEW_EXERCISES} övningar`);
		else
			// Only the validated (trimmed) fields are kept, so nothing else from the client reaches storage or a prompt.
			s.newExercises = s.newExercises.map((n, i): NewSessionExercise | null => {
				const p = `session.newExercises[${i}]`;
				if (!isObject(n) || typeof n.id !== 'string' || !NEW_EXERCISE_ID.test(n.id)) {
					issues.push(`${p}.id är ogiltigt`);
					return null;
				}
				const found = new Issues();
				const fields = validateExerciseInput(n, found, p);
				issues.push(...found.list);
				return fields && { id: n.id, ...fields };
			});
	}
	return s as unknown as ActiveSession;
}

/** Basic check of the save input before anything is read from storage. */
export function parseSaveSessionInput(raw: unknown): SaveSessionInput {
	const issues: string[] = [];
	if (!isObject(raw) || !isObject(raw.session)) throw new ValidationError('sparning', ['session saknas']);
	const session = checkActiveSession(raw.session, issues);
	if (raw.session.preparing === true) issues.push('passet har inte startat');
	if (typeof raw.endedAt !== 'string' || !DATETIME.test(raw.endedAt)) issues.push('endedAt är ogiltig');
	const kcal = raw.kcalEstimate;
	if (kcal !== undefined && kcal !== null && (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal < 0 || kcal > 5000))
		issues.push('kcalEstimate är ogiltig');
	if (issues.length || !session) throw new ValidationError('sparning', issues);
	return {
		session,
		endedAt: raw.endedAt as string,
		...(typeof kcal === 'number' ? { kcalEstimate: Math.round(kcal) } : {}),
		saveAsNewVersion: raw.saveAsNewVersion === true
	};
}

/**
 * Builds the next workout version with the deviations applied: each swapped
 * exercise is replaced in place. If the type changes (e.g. reps → time), the
 * target is taken from the set done during the session.
 */
export function applyDeviations(
	base: WorkoutTemplate,
	deviations: readonly Deviation[],
	exercises: ReadonlyMap<string, Exercise>,
	doneSets: ReadonlyMap<string, ExerciseSet[]>
): WorkoutTemplate['exercises'] {
	const swaps = new Map(deviations.filter((d) => d.type === 'swap').map((d) => [d.from, d.to]));
	return base.exercises.map((we) => {
		const to = swaps.get(we.exerciseId);
		if (!to) return we;
		const type = exercises.get(to)?.type;
		let target: Target = we.target;
		if (type && !targetMatchesType(target, type)) {
			const first = doneSets.get(to)?.[0];
			target =
				type === 'time'
					? { seconds: first && 'seconds' in first && first.seconds > 0 ? first.seconds : 30 }
					: { reps: first && 'reps' in first && first.reps > 0 ? first.reps : 8 };
		}
		return { exerciseId: to, sets: we.sets, target };
	});
}

/**
 * Creates the exercises written in during the session and returns the
 * session with their real ids. Only those that are used are created: with a
 * done set, or swapped into the workout when it is saved as a new version.
 * Creating finds an exercise with the same name and type, so a retry reuses
 * what an earlier attempt created. Deviations to an exercise that was not
 * created are dropped.
 */
export async function resolveNewExercises(storage: UserStorage, input: SaveSessionInput): Promise<ActiveSession> {
	const { session } = input;
	const pending = new Map((session.newExercises ?? []).map((n) => [n.id, n]));
	const { newExercises: _, ...rest } = session;
	if (!pending.size) return rest;

	const hasDoneSet = (id: string) => session.exercises.some((e) => e.exerciseId === id && e.sets.some((s) => isObject(s) && s.done === true));
	const keepInWorkout = (id: string) => input.saveAsNewVersion && session.deviations.some((d) => d.to === id);
	const used = [...pending.values()].filter((n) => hasDoneSet(n.id) || keepInWorkout(n.id));

	const realId = new Map<string, string>();
	if (used.length) {
		const catalog = (await listExercises(storage)).map((e) => e.data);
		for (const { id, ...fields } of used) realId.set(id, (await findOrCreateExercise(storage, catalog, fields)).exercise.id);
	}
	const map = (id: string) => realId.get(id) ?? id;
	return {
		...rest,
		exercises: session.exercises.filter((e) => !pending.has(e.exerciseId) || realId.has(e.exerciseId)).map((e) => ({ ...e, exerciseId: map(e.exerciseId) })),
		deviations: session.deviations
			.filter((d) => (!pending.has(d.to) || realId.has(d.to)) && !pending.has(d.from))
			.map((d) => ({ ...d, to: map(d.to) }))
	};
}

/**
 * What can be checked before anything is written, so a save that will fail
 * creates no exercises: written-in exercises' done sets against their type,
 * and that at least one set is done. Stored exercises are checked in saveSession.
 */
function precheck(session: ActiveSession): void {
	const issues = new Issues();
	const written = new Map((session.newExercises ?? []).map((n) => [n.id, n]));
	let anyDone = false;
	for (const [i, ex] of session.exercises.entries()) {
		ex.sets.forEach((set, j) => {
			if (!isObject(set) || set.done !== true) return;
			anyDone = true;
			const n = written.get(ex.exerciseId);
			if (n) validateSet(set, n.type, issues, `session.exercises[${i}].sets[${j}]`);
		});
	}
	if (!issues.ok) throw new ValidationError('sparning', issues.list);
	if (!anyDone) throw new ValidationError('sparning', ['Inga set är markerade som klara']);
}

export async function saveSession(storage: UserStorage, input: SaveSessionInput): Promise<SaveSessionResult> {
	const base = (await getWorkout(storage, input.session.workoutSlug, input.session.workoutVersion))?.data;
	if (!base) throw new ValidationError('sparning', [`Passet ${input.session.workoutSlug} v${input.session.workoutVersion} finns inte`]);
	precheck(input.session);
	const session = await resolveNewExercises(storage, input);
	const date = session.startedAt.slice(0, 10);

	// Read the exercises and validate the done sets against their type.
	const exercises = new Map<string, Exercise>();
	const doneSets = new Map<string, ExerciseSet[]>();
	const notes = new Map<string, string>();
	const issues = new Issues();
	for (const [i, ex] of session.exercises.entries()) {
		const stored = await getExercise(storage, ex.exerciseId);
		if (!stored) {
			issues.add(`session.exercises[${i}]`, `övningen ${ex.exerciseId} finns inte`);
			continue;
		}
		exercises.set(ex.exerciseId, stored.data);
		const sets = ex.sets
			.map((set, j) => ({ set, j }))
			.filter(({ set }) => isObject(set) && set.done === true)
			.map(({ set, j }) => validateSet(set, stored.data.type, issues, `session.exercises[${i}].sets[${j}]`))
			.filter((s) => s !== null);
		if (sets.length) doneSets.set(ex.exerciseId, [...(doneSets.get(ex.exerciseId) ?? []), ...sets]);
		const note = typeof ex.note === 'string' ? ex.note.trim() : '';
		if (note) notes.set(ex.exerciseId, note);
	}
	if (!issues.ok) throw new ValidationError('sparning', issues.list);
	if (doneSets.size === 0) throw new ValidationError('sparning', ['Inga set är markerade som klara']);

	// Pick the session id. An existing record with the same id and start time
	// means a retry; otherwise a free id for the day is chosen.
	let sessionId = session.sessionId;
	let alreadySaved = false;
	const existing = await getSession(storage, sessionId);
	if (existing) {
		const savedStart = existing.data.originalStartedAt ?? existing.data.startedAt;
		if (savedStart === session.startedAt) alreadySaved = true;
		else sessionId = sessionIdFor(date, new Set(await listSessionIds(storage)));
	}

	// Exercise logs, without duplicates on retry. The record is written last, so
	// once it exists every log entry was written; it may since have been edited
	// (an exercise removed), which a retry must not undo.
	for (const [exerciseId, sets] of doneSets) {
		if (alreadySaved) break;
		if (exercises.get(exerciseId)!.log.some((e) => e.sessionId === sessionId)) continue;
		const note = notes.get(exerciseId);
		await prependLogEntry(storage, exerciseId, { sessionId, date, sets, ...(note ? { note } : {}) });
	}

	// New workout version with the deviations, if the user wants it.
	let newWorkoutVersion: number | undefined;
	if (input.saveAsNewVersion && session.deviations.length) {
		const next = applyDeviations(base, session.deviations, exercises, doneSets);
		const latest = await getLatestWorkout(storage, base.slug);
		const unchanged = latest && JSON.stringify(latest.exercises) === JSON.stringify(next);
		if (unchanged) {
			if (latest.version !== base.version) newWorkoutVersion = latest.version;
		} else {
			const names = new Map([...exercises.values()].map((e) => [e.id, e.name]));
			for (const d of session.deviations) {
				if (!names.has(d.from)) {
					const from = await getExercise(storage, d.from);
					if (from) names.set(d.from, from.data.name);
				}
			}
			const name = (id: string) => names.get(id) ?? id;
			const saved = await saveWorkoutVersion(storage, {
				slug: base.slug,
				name: base.name,
				createdAt: date,
				changeNote: session.deviations.map((d) => `Byt ${name(d.from)} mot ${name(d.to)}`).join(', '),
				exercises: next
			});
			newWorkoutVersion = saved.version;
		}
	}

	if (!alreadySaved) {
		const record: SessionRecord = {
			id: sessionId,
			workoutSlug: session.workoutSlug,
			workoutVersion: session.workoutVersion,
			startedAt: session.startedAt,
			endedAt: input.endedAt,
			exerciseIds: [...doneSets.keys()],
			deviations: session.deviations,
			...(input.kcalEstimate !== undefined ? { kcalEstimate: input.kcalEstimate } : {})
		};
		await createSession(storage, record);
	}

	return { sessionId, alreadySaved, ...(newWorkoutVersion ? { newWorkoutVersion } : {}) };
}
