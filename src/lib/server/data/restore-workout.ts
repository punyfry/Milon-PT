import { targetMatchesType, type WorkoutTemplate } from '../../model';
import type { UserStorage } from '../storage/types';
import { findDeletedExercises, getExercise, undeleteExercise } from './exercises';
import { getLatestWorkout, getWorkout, saveWorkoutVersion } from './workouts';

/** The version can't be restored as it is; the message is shown to the user. */
export class WorkoutRestoreError extends Error {
	/** Restoring without the conflicting exercises would work, since some exercises are left. */
	readonly skippable: boolean;
	constructor(message: string, skippable = false) {
		super(message);
		this.name = 'WorkoutRestoreError';
		this.skippable = skippable;
	}
}

const exerciseWord = (count: number) => (count === 1 ? 'Övningen' : 'Övningarna');

/**
 * Restores an older version by saving it as the next version. Nothing is
 * overwritten. An exercise that has changed type since (so its target, reps or
 * seconds, no longer matches, #49) or that was deleted and whose name a new
 * exercise has taken (#46) is a conflict: the restore is refused, or with
 * `skipConflicts` saved without those exercises (#71), unless none would be
 * left or the result equals the latest version. Any other deleted exercise the
 * version keeps is brought back. Returns null if the version doesn't exist.
 */
export async function restoreWorkoutVersion(
	storage: UserStorage,
	slug: string,
	version: number,
	today: string,
	{ skipConflicts = false } = {}
): Promise<WorkoutTemplate | null> {
	const old = (await getWorkout(storage, slug, version))?.data;
	if (!old) return null;
	const exercises = await Promise.all(old.exercises.map((we) => getExercise(storage, we.exerciseId)));
	const changed = new Map<string, string>();
	old.exercises.forEach((we, i) => {
		const exercise = exercises[i]?.data;
		if (exercise && !targetMatchesType(we.target, exercise.type)) changed.set(exercise.id, exercise.name);
	});
	const deleted = await findDeletedExercises(storage, old.exercises.map((we) => we.exerciseId));
	const clash = new Map(deleted.filter((d) => d.namesake).map((d) => [d.stored.data.id, d.stored.data.name]));

	const conflicts = new Map([...changed, ...clash]);
	const kept = old.exercises.filter((we) => !conflicts.has(we.exerciseId));
	const latest = conflicts.size ? await getLatestWorkout(storage, slug) : null;
	const sameAsLatest = latest !== null && JSON.stringify(kept) === JSON.stringify(latest.exercises);
	const skippable = kept.length > 0 && !sameAsLatest;
	if (conflicts.size && (!skipConflicts || !skippable)) {
		const reasons: string[] = [];
		if (changed.size) reasons.push(`${exerciseWord(changed.size)} ${[...changed.values()].join(', ')} har bytt typ sedan den här versionen.`);
		if (clash.size)
			reasons.push(
				`${exerciseWord(clash.size)} ${[...clash.values()].join(', ')} togs bort och det finns en ny övning med samma namn. Ta bort den nya eller byt namn på den först.`
			);
		if (kept.length && sameAsLatest) reasons.push('Utan dem blir den likadan som versionen du har nu.');
		throw new WorkoutRestoreError(reasons.join(' '), skippable);
	}

	// Only exercises the restored version keeps come back; a skipped one may also have been deleted.
	for (const { stored } of deleted) if (!conflicts.has(stored.data.id)) await undeleteExercise(storage, stored);
	const skipped = [...conflicts.values()];
	return saveWorkoutVersion(storage, {
		slug: old.slug,
		name: old.name,
		createdAt: today,
		changeNote: `Återställd från version ${version}${skipped.length ? ` utan ${skipped.join(', ')}` : ''}`,
		exercises: kept
	});
}
