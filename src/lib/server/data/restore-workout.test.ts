import { describe, expect, it } from 'vitest';
import { MemoryUserStorage } from '../storage/memory';
import { WorkoutRestoreError, createExercise, getLatestWorkout, restoreWorkoutVersion, saveWorkoutVersion, updateExerciseDetails } from '.';

async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Marklyft', type: 'weight', instruction: '' });
	await createExercise(storage, { name: 'Plankan', type: 'bodyweight', instruction: '' });
	await createExercise(storage, { name: 'Utfall', type: 'bodyweight', instruction: '' });
	const all = [
		{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } },
		{ exerciseId: 'ex_plankan', sets: 2, target: { reps: 10 } },
		{ exerciseId: 'ex_utfall', sets: 2, target: { reps: 10 } }
	];
	await saveWorkoutVersion(storage, { slug: 'pass-b', name: 'Pass B', createdAt: '2026-10-01', exercises: all });
	await saveWorkoutVersion(storage, { slug: 'pass-b', name: 'Pass B', createdAt: '2026-10-02', exercises: all.slice(0, 1) });
	return storage;
}

describe('restore workout version', () => {
	it('saves the old version as the next one', async () => {
		const storage = await setup();
		const restored = await restoreWorkoutVersion(storage, 'pass-b', 1, '2026-10-08');
		expect(restored).toMatchObject({ version: 3, createdAt: '2026-10-08', changeNote: 'Återställd från version 1' });
		expect((await getLatestWorkout(storage, 'pass-b'))!.exercises).toHaveLength(3);
	});

	it('returns null for a version that does not exist', async () => {
		expect(await restoreWorkoutVersion(await setup(), 'pass-b', 9, '2026-10-08')).toBeNull();
	});

	it('refuses when an exercise has changed type since the version (#49)', async () => {
		const storage = await setup();
		await updateExerciseDetails(storage, 'ex_plankan', { name: 'Plankan', type: 'time', instruction: '' });
		await expect(restoreWorkoutVersion(storage, 'pass-b', 1, '2026-10-08')).rejects.toThrow(
			new WorkoutRestoreError('Övningen Plankan har bytt typ sedan den här versionen.')
		);
		expect((await getLatestWorkout(storage, 'pass-b'))!.version).toBe(2);

		await updateExerciseDetails(storage, 'ex_utfall', { name: 'Utfall', type: 'time', instruction: '' });
		await expect(restoreWorkoutVersion(storage, 'pass-b', 1, '2026-10-08')).rejects.toThrow(
			'Övningarna Plankan, Utfall har bytt typ sedan den här versionen.'
		);
	});

	it('allows a type change that keeps the target unit', async () => {
		const storage = await setup();
		await updateExerciseDetails(storage, 'ex_utfall', { name: 'Utfall', type: 'weight', instruction: '' });
		expect((await restoreWorkoutVersion(storage, 'pass-b', 1, '2026-10-08'))!.version).toBe(3);
	});
});
