import {
	Issues,
	ValidationError,
	assertValid,
	issueText,
	exerciseIdBase,
	findSameExercise,
	normalizeName,
	uniqueId,
	validateExercise,
	validateExerciseInput,
	type Exercise,
	type LogEntry
} from '../../model';
import { listLatestWorkouts } from './workouts';
import { StorageConflictError, type StoredJson, type UserStorage } from '../storage/types';

const DIR = 'exercises/';
const path = (id: string) => `${DIR}${id}.json`;

export async function getExercise(storage: UserStorage, id: string): Promise<StoredJson<Exercise> | null> {
	const file = await storage.readJson<unknown>(path(id));
	if (!file) return null;
	return { data: assertValid(`övning ${id}`, file.data, validateExercise), version: file.version };
}

export async function listExerciseIds(storage: UserStorage): Promise<string[]> {
	const files = await storage.list(DIR);
	return files
		.map((f) => f.path.slice(DIR.length))
		.filter((name) => name.endsWith('.json') && !name.includes('/'))
		.map((name) => name.slice(0, -'.json'.length));
}

export async function listExercises(storage: UserStorage): Promise<StoredJson<Exercise>[]> {
	const ids = await listExerciseIds(storage);
	const all = await Promise.all(ids.map((id) => getExercise(storage, id)));
	return all.filter((e): e is StoredJson<Exercise> => e !== null);
}

export type NewExercise = Omit<Exercise, 'id' | 'deleted' | 'log'> & Partial<Pick<Exercise, 'log'>>;

/**
 * Creates an exercise with a free id derived from the name (`ex_marklyft`,
 * `ex_marklyft_2`, …). Pass `takenIds` to skip an extra listing when the
 * caller already has it.
 */
export async function createExercise(
	storage: UserStorage,
	input: NewExercise,
	takenIds?: ReadonlySet<string>
): Promise<StoredJson<Exercise>> {
	const taken = new Set(takenIds ?? (await listExerciseIds(storage)));
	for (let attempt = 0; attempt < 5; attempt++) {
		const exercise: Exercise = assertValid(
			'övning',
			{
				log: [],
				...input,
				id: uniqueId(exerciseIdBase(input.name), taken)
			},
			validateExercise
		);
		try {
			const { version } = await storage.writeJson(path(exercise.id), exercise, { createOnly: true });
			return { data: exercise, version };
		} catch (e) {
			if (!(e instanceof StorageConflictError)) throw e;
			taken.add(exercise.id);
		}
	}
	throw new Error(`Kunde inte hitta ett ledigt id för ${input.name}`);
}

/**
 * The active exercise with the same name (ignoring case and spaces) and type,
 * or a new one. Makes creating by name safe to retry: a second call finds
 * what the first one created. `catalog` is every stored exercise.
 */
export async function findOrCreateExercise(
	storage: UserStorage,
	catalog: Exercise[],
	input: Pick<Exercise, 'name' | 'type' | 'instruction'>
): Promise<{ exercise: Exercise; created: boolean }> {
	const existing = findSameExercise(catalog.filter((e) => !e.deleted), input);
	if (existing) return { exercise: existing, created: false };
	const { data } = await createExercise(storage, input, new Set(catalog.map((e) => e.id)));
	catalog.push(data);
	return { exercise: data, created: true };
}

/** Overwrites an exercise. `version` from the read guards against concurrent changes. */
export async function saveExercise(
	storage: UserStorage,
	exercise: Exercise,
	version: string
): Promise<StoredJson<Exercise>> {
	const valid = assertValid(`övning ${exercise.id}`, exercise, validateExercise);
	const result = await storage.writeJson(path(valid.id), valid, { ifMatch: version });
	return { data: valid, version: result.version };
}

/**
 * Why the type of an exercise can't change, or null if it can: logged sets
 * are stored per type, and a workout's target is in reps or seconds.
 */
export async function typeLockReason(storage: UserStorage, exercise: Exercise): Promise<string | null> {
	if (exercise.log.length) return 'Typen går inte att ändra när det finns loggade set.';
	const using = await workoutsUsing(storage, exercise.id);
	if (using.length) return `Typen går inte att ändra när övningen finns i ett pass (${using.join(', ')}).`;
	return null;
}

/** Names of the workouts whose latest version uses the exercise. */
async function workoutsUsing(storage: UserStorage, id: string): Promise<string[]> {
	return (await listLatestWorkouts(storage)).filter((w) => w.exercises.some((e) => e.exerciseId === id)).map((w) => w.name);
}

/**
 * Why the exercise can't be deleted, or null if it can: the latest version of
 * a workout uses it. Older versions don't count; restoring one brings the
 * exercise back.
 */
export async function deleteLockReason(storage: UserStorage, exercise: Exercise): Promise<string | null> {
	const using = await workoutsUsing(storage, exercise.id);
	if (!using.length) return null;
	return `Övningen används i ${using.length === 1 ? 'passet' : 'passen'} ${using.join(', ')}. Ta bort den ur passet först.`;
}

/**
 * Deletes an exercise from the catalog (#46). The file is kept, marked
 * `deleted`, so its logged sets stay in history and in old sessions. Throws
 * ValidationError with a message for the user.
 */
export async function deleteExercise(storage: UserStorage, id: string): Promise<void> {
	const current = await getExercise(storage, id);
	if (!current || current.data.deleted) throw new ValidationError('övning', ['Övningen finns inte.']);
	const reason = await deleteLockReason(storage, current.data);
	if (reason) throw new ValidationError('övning', [reason]);
	await saveExercise(storage, { ...current.data, deleted: true }, current.version);
}

/**
 * Changes an exercise's name, type and instruction (`input` as typed by the
 * user). The type is locked as `typeLockReason` says, and the name may not be taken by another active exercise of the same
 * type. Throws ValidationError with messages for the user.
 */
export async function updateExerciseDetails(storage: UserStorage, id: string, input: unknown): Promise<StoredJson<Exercise>> {
	const issues = new Issues();
	const fields = validateExerciseInput(input, issues, '');
	if (!fields) throw new ValidationError('övning', issues.list.map(issueText));
	const current = await getExercise(storage, id);
	if (!current || current.data.deleted) throw new ValidationError('övning', ['Övningen finns inte.']);
	if (fields.type !== current.data.type) {
		const reason = await typeLockReason(storage, current.data);
		if (reason) throw new ValidationError('övning', [reason]);
	}
	const key = normalizeName(fields.name);
	const taken = (await listExercises(storage)).some(
		({ data: e }) => e.id !== id && !e.deleted && e.type === fields.type && normalizeName(e.name) === key
	);
	if (taken) throw new ValidationError('övning', [`Det finns redan en övning som heter ${fields.name}.`]);
	return saveExercise(storage, { ...current.data, ...fields }, current.version);
}

/** Sorts the log newest first. Stable, so entries on the same day keep their order. */
export function sortLog(log: LogEntry[]): LogEntry[] {
	return [...log].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Adds a log entry. The log is kept sorted newest first; an entry with the
 * same date as existing ones goes before them.
 */
export async function prependLogEntry(
	storage: UserStorage,
	exerciseId: string,
	entry: LogEntry
): Promise<StoredJson<Exercise>> {
	const current = await getExercise(storage, exerciseId);
	if (!current) throw new Error(`Övningen ${exerciseId} finns inte`);
	const updated = { ...current.data, log: sortLog([entry, ...current.data.log]) };
	return saveExercise(storage, updated, current.version);
}
