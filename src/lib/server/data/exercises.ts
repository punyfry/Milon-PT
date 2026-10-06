import {
	assertValid,
	exerciseIdBase,
	uniqueId,
	validateExercise,
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
 * Skapar en övning med ett ledigt id härlett ur namnet (`ex_marklyft`,
 * `ex_marklyft_2`, …). `takenIds` kan skickas med för att undvika en extra
 * listning när anroparen redan har den.
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

/** Skriver över en övning. `version` från läsningen skyddar mot samtidiga ändringar. */
export async function saveExercise(
	storage: UserStorage,
	exercise: Exercise,
	version: string
): Promise<StoredJson<Exercise>> {
	const valid = assertValid(`övning ${exercise.id}`, exercise, validateExercise);
	const result = await storage.writeJson(path(valid.id), valid, { ifMatch: version });
	return { data: valid, version: result.version };
}

/** Sorterar loggen nyaste först. Stabil, så poster samma dag behåller sin ordning. */
export function sortLog(log: LogEntry[]): LogEntry[] {
	return [...log].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Lägger till en loggpost först i loggen (den är nyast). */
export async function prependLogEntry(
	storage: UserStorage,
	exerciseId: string,
	entry: LogEntry
): Promise<StoredJson<Exercise>> {
	const current = await getExercise(storage, exerciseId);
	if (!current) throw new Error(`Övningen ${exerciseId} finns inte`);
	const updated = { ...current.data, log: [entry, ...current.data.log] };
	return saveExercise(storage, updated, current.version);
}
