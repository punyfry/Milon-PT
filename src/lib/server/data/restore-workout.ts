import { targetMatchesType, type WorkoutTemplate } from '../../model';
import type { UserStorage } from '../storage/types';
import { getExercise } from './exercises';
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
 * target (reps or seconds) no longer matches. Returns null if the version
 * doesn't exist.
 */
export async function restoreWorkoutVersion(
	storage: UserStorage,
	slug: string,
	version: number,
	today: string
): Promise<WorkoutTemplate | null> {
	const old = (await getWorkout(storage, slug, version))?.data;
	if (!old) return null;
	const changed: string[] = [];
	for (const we of old.exercises) {
		const exercise = (await getExercise(storage, we.exerciseId))?.data;
		if (exercise && !targetMatchesType(we.target, exercise.type)) changed.push(exercise.name);
	}
	if (changed.length) {
		const names = changed.join(', ');
		throw new WorkoutRestoreError(
			changed.length === 1
				? `Övningen ${names} har bytt typ sedan den här versionen.`
				: `Övningarna ${names} har bytt typ sedan den här versionen.`
		);
	}
	return saveWorkoutVersion(storage, {
		slug: old.slug,
		name: old.name,
		createdAt: today,
		changeNote: `Återställd från version ${version}`,
		exercises: old.exercises
	});
}
