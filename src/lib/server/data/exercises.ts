import {
	Issues,
	ValidationError,
	assertValid,
	issueText,
	exerciseIdBase,
	normalizeName,
	uniqueId,
	validateExercise,
	validateExerciseInput,
	type Exercise,
	type LogEntry
} from '../../model';
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

export type NewExercise = Omit<Exercise, 'id' | 'archived' | 'log'> & Partial<Pick<Exercise, 'archived' | 'log'>>;

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
				archived: false,
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
	const key = normalizeName(input.name);
	const existing = catalog.find((e) => !e.archived && e.type === input.type && normalizeName(e.name) === key);
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
 * Changes an exercise's name, type and instruction (`input` as typed by the
 * user). The type is locked once sets are logged, since sets are stored per
 * type, and the name may not be taken by another active exercise of the same
 * type. Throws ValidationError with messages for the user.
 */
export async function updateExerciseDetails(storage: UserStorage, id: string, input: unknown): Promise<StoredJson<Exercise>> {
	const issues = new Issues();
	const fields = validateExerciseInput(input, issues, '');
	if (!fields) throw new ValidationError('övning', issues.list.map(issueText));
	const current = await getExercise(storage, id);
	if (!current) throw new ValidationError('övning', ['Övningen finns inte.']);
	if (fields.type !== current.data.type && current.data.log.length)
		throw new ValidationError('övning', ['Typen går inte att ändra när det finns loggade set.']);
	const key = normalizeName(fields.name);
	const taken = (await listExercises(storage)).some(
		({ data: e }) => e.id !== id && !e.archived && e.type === fields.type && normalizeName(e.name) === key
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
