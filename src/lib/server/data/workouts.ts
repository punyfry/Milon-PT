import {
	assertValid,
	parseWorkoutFileName,
	validateWorkout,
	workoutFileName,
	type WorkoutTemplate
} from '../../model';
import { StorageConflictError, type StoredJson, type UserStorage } from '../storage/types';

const DIR = 'workouts/';

/** All versions per slug, sorted ascending. */
export async function listWorkoutVersions(storage: UserStorage): Promise<Map<string, number[]>> {
	const files = await storage.list(DIR);
	const bySlug = new Map<string, number[]>();
	for (const f of files) {
		const parsed = parseWorkoutFileName(f.path.slice(DIR.length));
		if (!parsed) continue;
		bySlug.set(parsed.slug, [...(bySlug.get(parsed.slug) ?? []), parsed.version]);
	}
	for (const versions of bySlug.values()) versions.sort((a, b) => a - b);
	return bySlug;
}

export async function getWorkout(
	storage: UserStorage,
	slug: string,
	version: number
): Promise<StoredJson<WorkoutTemplate> | null> {
	const file = await storage.readJson<unknown>(DIR + workoutFileName(slug, version));
	if (!file) return null;
	return { data: assertValid(`pass ${slug} v${version}`, file.data, validateWorkout), version: file.version };
}

export interface VersionSummary {
	version: number;
	createdAt: string;
	changeNote: string | null;
	exerciseCount: number;
}

/** Every version of a workout, newest first, with the latest in full. Null if the workout doesn't exist. */
export async function getWorkoutHistory(
	storage: UserStorage,
	slug: string
): Promise<{ latest: WorkoutTemplate; versions: VersionSummary[] } | null> {
	const numbers = (await listWorkoutVersions(storage)).get(slug);
	if (!numbers?.length) return null;
	const all = (await Promise.all(numbers.map((v) => getWorkout(storage, slug, v)))).filter((w) => w !== null).map((w) => w.data);
	if (!all.length) return null;
	const versions = all
		.map((w) => ({ version: w.version, createdAt: w.createdAt, changeNote: w.changeNote ?? null, exerciseCount: w.exercises.length }))
		.reverse();
	return { latest: all[all.length - 1], versions };
}

/** Latest version of a workout, or null if it doesn't exist. */
export async function getLatestWorkout(storage: UserStorage, slug: string): Promise<WorkoutTemplate | null> {
	const versions = (await listWorkoutVersions(storage)).get(slug);
	if (!versions?.length) return null;
	return (await getWorkout(storage, slug, versions[versions.length - 1]))?.data ?? null;
}

/** Latest version of each workout (highest `version` per slug). */
export async function listLatestWorkouts(storage: UserStorage): Promise<WorkoutTemplate[]> {
	const bySlug = await listWorkoutVersions(storage);
	const latest = await Promise.all(
		[...bySlug].map(([slug, versions]) => getWorkout(storage, slug, versions[versions.length - 1]))
	);
	return latest.filter((w) => w !== null).map((w) => w.data);
}

/**
 * Saves a new version of a workout; older versions are left untouched.
 * The version number is computed here and the file is written with
 * `createOnly`, so two concurrent saves can't overwrite each other.
 */
export async function saveWorkoutVersion(
	storage: UserStorage,
	workout: Omit<WorkoutTemplate, 'version'>
): Promise<WorkoutTemplate> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const versions = (await listWorkoutVersions(storage)).get(workout.slug) ?? [];
		const next = (versions[versions.length - 1] ?? 0) + 1;
		const template = assertValid('pass', { ...workout, version: next }, validateWorkout);
		try {
			await storage.writeJson(DIR + workoutFileName(template.slug, next), template, { createOnly: true });
			return template;
		} catch (e) {
			if (!(e instanceof StorageConflictError)) throw e;
		}
	}
	throw new Error(`Kunde inte spara ny version av ${workout.slug}`);
}
