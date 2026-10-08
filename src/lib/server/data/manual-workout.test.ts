import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../model';
import { MemoryUserStorage } from '../storage/memory';
import { WorkoutChangedError, createExercise, getExercise, getLatestWorkout, listExercises, listWorkoutVersions, parseManualWorkoutInput, saveManualWorkout } from '.';

const TODAY = '2026-10-08';

async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Marklyft', type: 'weight', instruction: '' });
	await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
	return storage;
}

const save = (storage: MemoryUserStorage, raw: unknown) => saveManualWorkout(storage, parseManualWorkoutInput(raw), TODAY);
const issues = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ValidationError) return e.issues.join(' ');
		throw e;
	}
	return '';
};
const rows = { newExercise: { name: 'Hantelrodd', type: 'weight', instruction: ' Rak rygg. ' }, sets: 3, target: { reps: 10 } };

describe('manual workout', () => {
	it('saves a new workout as version 1 and creates written-in exercises', async () => {
		const storage = await setup();
		const result = await save(storage, {
			name: ' Pass  C ',
			items: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }, rows, { exerciseId: 'ex_plankan', sets: 2, target: { seconds: 45 } }]
		});
		expect(result).toEqual({ slug: 'pass-c', version: 1, saved: true });
		const workout = (await getLatestWorkout(storage, 'pass-c'))!;
		expect(workout).toMatchObject({ name: 'Pass C', createdAt: TODAY, changeNote: 'Byggt för hand' });
		expect(workout.exercises.map((e) => e.exerciseId)).toEqual(['ex_marklyft', 'ex_hantelrodd', 'ex_plankan']);
		expect((await getExercise(storage, 'ex_hantelrodd'))!.data).toMatchObject({ name: 'Hantelrodd', type: 'weight', instruction: 'Rak rygg.', archived: false });
	});

	it('saves an edit as the next version with a change note, and nothing when unchanged', async () => {
		const storage = await setup();
		await save(storage, { name: 'Pass C', items: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }, { exerciseId: 'ex_plankan', sets: 2, target: { seconds: 45 } }] });
		const edit = { editSlug: 'pass-c', baseVersion: 1, name: 'Pass C', items: [{ exerciseId: 'ex_plankan', sets: 3, target: { seconds: 45 } }, rows] };
		expect(await save(storage, edit)).toEqual({ slug: 'pass-c', version: 2, saved: true });
		expect((await getLatestWorkout(storage, 'pass-c'))!.changeNote).toBe('Lade till Hantelrodd, tog bort Marklyft, ändrade set eller mål');
		expect(await save(storage, { ...edit, baseVersion: 2 })).toEqual({ slug: 'pass-c', version: 2, saved: false });
		expect((await listWorkoutVersions(storage)).get('pass-c')).toEqual([1, 2]);
		// The written-in exercise now exists and is reused, not created again.
		expect((await listExercises(storage)).filter((e) => e.data.name === 'Hantelrodd')).toHaveLength(1);
	});

	it('refuses a new workout with the name of an existing one', async () => {
		const storage = await setup();
		const input = { name: 'Pass C', items: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }] };
		await save(storage, input);
		await expect(save(storage, { ...input, name: 'pass c' })).rejects.toThrow(/redan ett pass/);
	});

	it('checks targets against the type and catches the same exercise twice before creating anything', async () => {
		const storage = await setup();
		await expect(save(storage, { name: 'X', items: [{ exerciseId: 'ex_plankan', sets: 2, target: { reps: 8 } }] })).rejects.toThrow(/sekunder/);
		await expect(save(storage, { name: 'X', items: [{ exerciseId: 'ex_saknas', sets: 2, target: { reps: 8 } }] })).rejects.toThrow(/finns inte/);
		const twice = { name: 'X', items: [rows, { ...rows, newExercise: { ...rows.newExercise, name: 'hantelrodd' } }] };
		await expect(save(storage, twice)).rejects.toThrow(/två gånger/);
		const sameAsExisting = { name: 'X', items: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }, { ...rows, newExercise: { name: 'Marklyft', type: 'weight' } }] };
		await expect(save(storage, sameAsExisting)).rejects.toThrow(/Marklyft finns två gånger/);
		expect(await getExercise(storage, 'ex_hantelrodd')).toBeNull();
	});

	it('validates the input with messages for the user', () => {
		expect(issues(() => parseManualWorkoutInput({ name: ' ', items: [] }))).toBe('Passet behöver ett namn. Passet behöver minst en övning.');
		expect(issues(() => parseManualWorkoutInput({ name: 'A', items: [{ exerciseId: 'ex_a', sets: 0, target: { reps: 8, seconds: 3 } }] }))).toMatch(
			/Övning 1: antal set.*Övning 1: ange mål/
		);
		expect(issues(() => parseManualWorkoutInput({ name: 'A', items: [{ sets: 3, target: { reps: 8 } }] }))).toMatch(/välj en övning/);
		expect(issues(() => parseManualWorkoutInput({ name: 'A', items: [{ ...rows, newExercise: { name: '', type: 'weight' } }] }))).toMatch(/Övning 1: Övningen behöver ett namn\./);
		expect(issues(() => parseManualWorkoutInput({ editSlug: '../x', name: 'A', items: [rows] }))).toMatch(/Ogiltigt pass/);
	});

	it('refuses to edit a workout that does not exist', async () => {
		const storage = await setup();
		await expect(save(storage, { editSlug: 'finns-inte', baseVersion: 1, name: 'A', items: [rows] })).rejects.toThrow(/finns inte längre/);
	});

	it('refuses an edit that started from an older version', async () => {
		const storage = await setup();
		const items = [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }];
		await save(storage, { name: 'Pass C', items });
		await save(storage, { editSlug: 'pass-c', baseVersion: 1, name: 'Pass C', items: [{ ...items[0], sets: 4 }] });
		await expect(save(storage, { editSlug: 'pass-c', baseVersion: 1, name: 'Pass C', items: [{ ...items[0], sets: 5 }] })).rejects.toBeInstanceOf(
			WorkoutChangedError
		);
		// The same edit sent again (its response was lost) is already saved.
		expect(await save(storage, { editSlug: 'pass-c', baseVersion: 1, name: 'Pass C', items: [{ ...items[0], sets: 4 }] })).toEqual({
			slug: 'pass-c',
			version: 2,
			saved: false
		});
		expect(issues(() => parseManualWorkoutInput({ editSlug: 'pass-c', name: 'A', items: [rows] }))).toMatch(/Ogiltig version/);
	});

	it('treats a repeated save of a new workout as already saved', async () => {
		const storage = await setup();
		const input = { name: 'Pass C', items: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }, rows] };
		await save(storage, input);
		expect(await save(storage, input)).toEqual({ slug: 'pass-c', version: 1, saved: false });
		await expect(save(storage, { ...input, items: [rows] })).rejects.toThrow(/redan ett pass/);
	});
});
