import { targetMatchesType, type WorkoutTemplate } from '../../model';
import type { UserStorage } from '../storage/types';
import { findDeletedExercises, getExercise, undeleteExercise } from './exercises';
import { getWorkout, saveWorkoutVersion } from './workouts';

/** The version can't be restored as it is; the message is shown to the user. */
export class WorkoutRestoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WorkoutRestoreError';
	}
}

/**
 * Restores an older version by saving it as the next version. Nothing is
 * overwritten. Refuses (#49) if an exercise has changed type since, so its
 * target (reps or seconds) no longer matches. A deleted exercise the version
 * uses is brought back (#46). Returns null if the version doesn't exist.
 */
export async function restoreWorkoutVersion(
	storage: UserStorage,
	slug: string,
	version: number,
	today: string
): Promise<WorkoutTemplate | null> {
	const old = (await getWorkout(storage, slug, version))?.data;
	if (!old) return null;
	const exercises = await Promise.all(old.exercises.map((we) => getExercise(storage, we.exerciseId)));
	const changed = new Set<string>();
	old.exercises.forEach((we, i) => {
		const exercise = exercises[i]?.data;
		if (exercise && !targetMatchesType(we.target, exercise.type)) changed.add(exercise.name);
	});
	if (changed.size) {
		const names = [...changed].join(', ');
		throw new WorkoutRestoreError(
			changed.size === 1
				? `Övningen ${names} har bytt typ sedan den här versionen.`
				: `Övningarna ${names} har bytt typ sedan den här versionen.`
		);
	}
	// A deleted exercise comes back, unless a new active one has taken its name since (#46).
	const deleted = await findDeletedExercises(storage, old.exercises.map((we) => we.exerciseId));
	const clash = deleted.filter((d) => d.namesake);
	if (clash.length) {
		const names = clash.map((d) => d.stored.data.name).join(', ');
		throw new WorkoutRestoreError(
			`${clash.length === 1 ? 'Övningen' : 'Övningarna'} ${names} togs bort och det finns en ny övning med samma namn. Ta bort den nya eller byt namn på den först.`
		);
	}
	for (const { stored } of deleted) await undeleteExercise(storage, stored);
	return saveWorkoutVersion(storage, {
		slug: old.slug,
		name: old.name,
		createdAt: today,
		changeNote: `Återställd från version ${version}`,
		exercises: old.exercises
	});
}
