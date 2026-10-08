import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../../model';
import { MemoryUserStorage } from '../storage/memory';
import {
	createExercise,
	deleteExercise,
	deleteSessionRecord,
	getExercise,
	getSession,
	listExercises,
	listLatestWorkouts,
	listSessionIds,
	parseSaveSessionInput,
	saveSession,
	saveSessionRecord,
	saveWorkoutVersion
} from '.';

async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Marklyft', type: 'weight', instruction: '' });
	await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
	await createExercise(storage, { name: 'Sidoplanka', type: 'time', instruction: '' });
	await createExercise(storage, { name: 'Hantelpress', type: 'weight', instruction: '' });
	await createExercise(storage, { name: 'Armhävning', type: 'bodyweight', instruction: '' });
	await saveWorkoutVersion(storage, {
		slug: 'pass-b',
		name: 'Pass B',
		createdAt: '2026-10-01',
		exercises: [
			{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } },
			{ exerciseId: 'ex_hantelpress', sets: 3, target: { reps: 10 } },
			{ exerciseId: 'ex_plankan', sets: 2, target: { seconds: 45 } }
		]
	});
	return storage;
}

function active(overrides: Partial<ActiveSession> = {}): ActiveSession {
	return {
		sessionId: 's_20261006',
		workoutSlug: 'pass-b',
		workoutVersion: 1,
		startedAt: '2026-10-06T17:10:00+02:00',
		lastActivityAt: '2026-10-06T18:00:00+02:00',
		exercises: [
			{
				exerciseId: 'ex_marklyft',
				sets: [
					{ weight: 40, reps: 8, done: true },
					{ weight: 45, reps: 6, done: true },
					{ weight: 45, reps: 6, done: false }
				]
			},
			{ exerciseId: 'ex_hantelpress', sets: [{ weight: 12.5, reps: 10, done: false }] },
			{ exerciseId: 'ex_plankan', sets: [{ seconds: 45, done: true, timerDuration: 45 } as never] }
		],
		deviations: [],
		...overrides
	};
}

const input = (session: ActiveSession, extra = {}) =>
	parseSaveSessionInput({ session, endedAt: '2026-10-06T18:05:00+02:00', kcalEstimate: 300, saveAsNewVersion: false, ...extra });

describe('save session', () => {
	it('writes done sets to the exercise logs and creates the session record', async () => {
		const storage = await setup();
		const result = await saveSession(storage, input(active()));
		expect(result).toEqual({ sessionId: 's_20261006', alreadySaved: false });

		const marklyft = (await getExercise(storage, 'ex_marklyft'))!.data;
		expect(marklyft.log).toEqual([
			{ sessionId: 's_20261006', date: '2026-10-06', sets: [{ weight: 40, reps: 8 }, { weight: 45, reps: 6 }] }
		]);
		expect((await getExercise(storage, 'ex_plankan'))!.data.log[0].sets).toEqual([{ seconds: 45 }]);
		expect((await getExercise(storage, 'ex_hantelpress'))!.data.log).toEqual([]);

		const record = (await getSession(storage, 's_20261006'))!.data;
		expect(record).toEqual({
			id: 's_20261006',
			workoutSlug: 'pass-b',
			workoutVersion: 1,
			startedAt: '2026-10-06T17:10:00+02:00',
			endedAt: '2026-10-06T18:05:00+02:00',
			exerciseIds: ['ex_marklyft', 'ex_plankan'],
			deviations: [],
			kcalEstimate: 300
		});
	});

	it("saves an exercise's note with its log entry, trimmed, and only for exercises with done sets", async () => {
		const storage = await setup();
		const session = active();
		session.exercises[0].note = '  Prova 50 kg nästa gång ';
		session.exercises[1].note = 'Ingen anteckning sparas här';
		session.exercises[1].sets = [{ weight: 12.5, reps: 10, done: false }];
		session.exercises[2].note = '   ';
		await saveSession(storage, input(session));
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log[0].note).toBe('Prova 50 kg nästa gång');
		expect((await getExercise(storage, 'ex_hantelpress'))!.data.log).toEqual([]);
		expect((await getExercise(storage, 'ex_plankan'))!.data.log[0]).not.toHaveProperty('note');
	});

	it('refuses a note that is too long or not text', () => {
		const session = active();
		session.exercises[0].note = 'x'.repeat(1001);
		expect(() => input(session)).toThrow(/högst 1000/);
		session.exercises[0].note = 5 as never;
		expect(() => input(session)).toThrow(/måste vara text/);
	});

	it('can be retried without duplicates', async () => {
		const storage = await setup();
		await saveSession(storage, input(active()));
		const again = await saveSession(storage, input(active()));
		expect(again.alreadySaved).toBe(true);
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log).toHaveLength(1);
		expect(await listSessionIds(storage)).toEqual(['s_20261006']);
	});

	it('gives the second session on the same day its own id', async () => {
		const storage = await setup();
		await saveSession(storage, input(active()));
		const second = await saveSession(storage, input(active({ startedAt: '2026-10-06T19:00:00+02:00' })));
		expect(second.sessionId).toBe('s_20261006_2');
		const log = (await getExercise(storage, 'ex_marklyft'))!.data.log;
		expect(log.map((l) => l.sessionId)).toEqual(['s_20261006_2', 's_20261006']);
	});

	it('recognises a retry of the second and third session of a day (#48)', async () => {
		const storage = await setup();
		await saveSession(storage, input(active()));
		const second = input(active({ startedAt: '2026-10-06T19:00:00+02:00' }));
		const third = input(active({ startedAt: '2026-10-06T21:00:00+02:00' }));
		await saveSession(storage, second);
		await saveSession(storage, third);

		expect(await saveSession(storage, second)).toEqual({ sessionId: 's_20261006_2', alreadySaved: true });
		expect(await saveSession(storage, third)).toEqual({ sessionId: 's_20261006_3', alreadySaved: true });
		expect((await listSessionIds(storage)).sort()).toEqual(['s_20261006', 's_20261006_2', 's_20261006_3']);
		const log = (await getExercise(storage, 'ex_marklyft'))!.data.log;
		expect(log.map((l) => l.sessionId)).toEqual(['s_20261006_3', 's_20261006_2', 's_20261006']);
	});

	it('recognises a retry of the second session after the first was deleted', async () => {
		const storage = await setup();
		await saveSession(storage, input(active()));
		const second = input(active({ startedAt: '2026-10-06T19:00:00+02:00' }));
		await saveSession(storage, second);
		await deleteSessionRecord(storage, 's_20261006');

		expect(await saveSession(storage, second)).toEqual({ sessionId: 's_20261006_2', alreadySaved: true });
		expect(await listSessionIds(storage)).toEqual(['s_20261006_2']);
	});

	it('does not take a session from another day with the same clock time for a retry', async () => {
		const storage = await setup();
		await saveSession(storage, input(active({ sessionId: 's_20261005', startedAt: '2026-10-05T19:00:00+02:00' })));
		await saveSession(storage, input(active()));
		const second = await saveSession(storage, input(active({ startedAt: '2026-10-06T19:00:00+02:00' })));
		expect(second).toEqual({ sessionId: 's_20261006_2', alreadySaved: false });
	});

	it('recognises a retry of a later session whose start was edited', async () => {
		const storage = await setup();
		await saveSession(storage, input(active()));
		await saveSession(storage, input(active({ startedAt: '2026-10-06T19:00:00+02:00' })));
		const stored = (await getSession(storage, 's_20261006_2'))!;
		await saveSessionRecord(
			storage,
			{ ...stored.data, startedAt: '2026-10-06T18:45:00+02:00', originalStartedAt: stored.data.startedAt },
			stored.version
		);

		const again = await saveSession(storage, input(active({ startedAt: '2026-10-06T19:00:00+02:00' })));
		expect(again).toEqual({ sessionId: 's_20261006_2', alreadySaved: true });
		expect(await listSessionIds(storage)).toHaveLength(2);
	});

	it('brings back a deleted exercise when the deviations are saved as a new version (#46)', async () => {
		const storage = await setup();
		// v2 drops Plankan, which is then deleted while a session on v1 is in progress.
		const v1 = (await listLatestWorkouts(storage))[0];
		await saveWorkoutVersion(storage, { ...v1, createdAt: '2026-10-02', exercises: v1.exercises.filter((e) => e.exerciseId !== 'ex_plankan') });
		await deleteExercise(storage, 'ex_plankan');

		const session = active({ deviations: [{ type: 'swap', from: 'ex_hantelpress', to: 'ex_armhavning' }] });
		session.exercises[1] = { exerciseId: 'ex_armhavning', sets: [{ reps: 12, done: true }] };
		const saved = await saveSession(storage, input(session, { saveAsNewVersion: true }));
		expect(saved.newWorkoutVersion).toBe(3);
		expect((await listLatestWorkouts(storage))[0].exercises.map((e) => e.exerciseId)).toContain('ex_plankan');
		expect((await getExercise(storage, 'ex_plankan'))!.data.deleted).toBeUndefined();
	});

	it('uses the active namesake of a deleted exercise in the new version instead of bringing it back', async () => {
		const storage = await setup();
		const v1 = (await listLatestWorkouts(storage))[0];
		await saveWorkoutVersion(storage, { ...v1, createdAt: '2026-10-02', exercises: v1.exercises.filter((e) => e.exerciseId !== 'ex_plankan') });
		await deleteExercise(storage, 'ex_plankan');
		await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });

		const session = active({ deviations: [{ type: 'swap', from: 'ex_hantelpress', to: 'ex_armhavning' }] });
		session.exercises[1] = { exerciseId: 'ex_armhavning', sets: [{ reps: 12, done: true }] };
		await saveSession(storage, input(session, { saveAsNewVersion: true }));
		const ids = (await listLatestWorkouts(storage))[0].exercises.map((e) => e.exerciseId);
		expect(ids).toEqual(['ex_marklyft', 'ex_armhavning', 'ex_plankan_2']);
		expect((await getExercise(storage, 'ex_plankan'))!.data.deleted).toBe(true);
	});

	it('does not bring back a deleted exercise that a swap took out of the workout', async () => {
		const storage = await setup();
		const v1 = (await listLatestWorkouts(storage))[0];
		await saveWorkoutVersion(storage, { ...v1, createdAt: '2026-10-02', exercises: v1.exercises.filter((e) => e.exerciseId !== 'ex_hantelpress') });
		await deleteExercise(storage, 'ex_hantelpress');

		const session = active({ deviations: [{ type: 'swap', from: 'ex_hantelpress', to: 'ex_armhavning' }] });
		session.exercises[1] = { exerciseId: 'ex_armhavning', sets: [{ reps: 12, done: true }] };
		await saveSession(storage, input(session, { saveAsNewVersion: true }));
		expect((await getExercise(storage, 'ex_hantelpress'))!.data.deleted).toBe(true);
	});

	it('refuses to save without done sets or with sets of the wrong type', async () => {
		const storage = await setup();
		const none = active();
		for (const ex of none.exercises) for (const s of ex.sets) s.done = false;
		await expect(saveSession(storage, input(none))).rejects.toThrow(/Inga set/);

		const wrong = active();
		wrong.exercises[2].sets = [{ reps: 10, done: true }];
		await expect(saveSession(storage, input(wrong))).rejects.toThrow(/seconds/);
		expect(await listSessionIds(storage)).toEqual([]);
	});

	it('creates a new workout version from deviations only if the user wants it', async () => {
		const storage = await setup();
		const swapped = active({
			deviations: [
				{ type: 'swap', from: 'ex_hantelpress', to: 'ex_armhavning' },
				{ type: 'swap', from: 'ex_plankan', to: 'ex_sidoplanka' }
			]
		});
		swapped.exercises[1] = { exerciseId: 'ex_armhavning', sets: [{ reps: 12, done: true }] };
		swapped.exercises[2] = { exerciseId: 'ex_sidoplanka', sets: [{ seconds: 30, done: true }] };

		const no = await saveSession(storage, input(swapped));
		expect(no.newWorkoutVersion).toBeUndefined();
		expect((await listLatestWorkouts(storage))[0].version).toBe(1);

		const yes = await saveSession(
			storage,
			input({ ...swapped, sessionId: 's_20261007', startedAt: '2026-10-07T17:00:00+02:00' }, { saveAsNewVersion: true })
		);
		expect(yes.newWorkoutVersion).toBe(2);
		const [v2] = await listLatestWorkouts(storage);
		expect(v2.changeNote).toBe('Byt Hantelpress mot Armhävning, Byt Plankan mot Sidoplanka');
		expect(v2.exercises).toEqual([
			{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } },
			{ exerciseId: 'ex_armhavning', sets: 3, target: { reps: 10 } },
			{ exerciseId: 'ex_sidoplanka', sets: 2, target: { seconds: 45 } }
		]);

		// A retry creates no v3.
		const retry = await saveSession(
			storage,
			input({ ...swapped, sessionId: 's_20261007', startedAt: '2026-10-07T17:00:00+02:00' }, { saveAsNewVersion: true })
		);
		expect(retry).toMatchObject({ alreadySaved: true, newWorkoutVersion: 2 });
		expect((await storage.list('workouts/')).length).toBe(2);
	});

	it('takes the target from the session when the swap changes exercise type', async () => {
		const storage = await setup();
		const swapped = active({ deviations: [{ type: 'swap', from: 'ex_hantelpress', to: 'ex_sidoplanka' }] });
		swapped.exercises[1] = { exerciseId: 'ex_sidoplanka', sets: [{ seconds: 40, done: true }] };
		await saveSession(storage, input(swapped, { saveAsNewVersion: true }));
		const [v2] = await listLatestWorkouts(storage);
		expect(v2.exercises[1]).toEqual({ exerciseId: 'ex_sidoplanka', sets: 3, target: { seconds: 40 } });
	});

	it('refuses to save a workout that has not been started', () => {
		expect(() => parseSaveSessionInput({ session: { ...active(), preparing: true }, endedAt: '2026-10-06T18:05:00+02:00' })).toThrow(/inte startat/);
		expect(() => parseSaveSessionInput({ session: { ...active(), preparing: 'ja' }, endedAt: '2026-10-06T18:05:00+02:00' })).toThrow(
			/preparing är ogiltig/
		);
		expect(() => parseSaveSessionInput({ session: { ...active(), preparing: false }, endedAt: '2026-10-06T18:05:00+02:00' })).not.toThrow();
	});

	it('rejects broken input before anything is read', () => {
		expect(() => parseSaveSessionInput({ session: { ...active(), sessionId: '../x' }, endedAt: 'nu' })).toThrow(
			/sessionId[\s\S]*endedAt/
		);
	});
});

describe('exercises written in during the session', () => {
	const rows = { name: 'Hantelrodd', type: 'weight' as const, instruction: 'Rak rygg.' };
	/** Hantelpress swapped for a new exercise with two done sets. */
	const withNew = (overrides: Partial<ActiveSession> = {}) =>
		active({
			exercises: [
				active().exercises[0],
				{ exerciseId: 'new_abc', sets: [{ weight: 14, reps: 10, done: true }, { weight: 14, reps: 9, done: true }] },
				active().exercises[2]
			],
			deviations: [{ type: 'swap', from: 'ex_hantelpress', to: 'new_abc' }],
			newExercises: [{ id: 'new_abc', ...rows }],
			...overrides
		});

	it('creates the exercise with its log and records the swap with the real id', async () => {
		const storage = await setup();
		await saveSession(storage, input(withNew()));
		const created = (await getExercise(storage, 'ex_hantelrodd'))!.data;
		expect(created).toMatchObject(rows);
		expect(created.deleted).toBeUndefined();
		expect(created.log).toEqual([{ sessionId: 's_20261006', date: '2026-10-06', sets: [{ weight: 14, reps: 10 }, { weight: 14, reps: 9 }] }]);
		const record = (await getSession(storage, 's_20261006'))!.data;
		expect(record.exerciseIds).toContain('ex_hantelrodd');
		expect(record.deviations).toEqual([{ type: 'swap', from: 'ex_hantelpress', to: 'ex_hantelrodd' }]);
	});

	it('is safe to retry: the second save reuses the exercise and logs nothing twice', async () => {
		const storage = await setup();
		await saveSession(storage, input(withNew()));
		const again = await saveSession(storage, input(withNew()));
		expect(again.alreadySaved).toBe(true);
		expect((await listExercises(storage)).map((e) => e.data.id).filter((id) => id.startsWith('ex_hantelrodd'))).toEqual(['ex_hantelrodd']);
		expect((await getExercise(storage, 'ex_hantelrodd'))!.data.log).toHaveLength(1);
	});

	it('saves the note of a written-in exercise with its log entry', async () => {
		const storage = await setup();
		const session = withNew();
		session.exercises[1].note = 'Tyngre nästa gång';
		await saveSession(storage, input(session));
		expect((await getExercise(storage, 'ex_hantelrodd'))!.data.log[0].note).toBe('Tyngre nästa gång');
	});

	it('uses an existing exercise with the same name and type', async () => {
		const storage = await setup();
		const session = withNew({ newExercises: [{ id: 'new_abc', name: ' sidoplanka ', type: 'time', instruction: '' }] });
		session.exercises[1].sets = [{ seconds: 30, done: true }];
		await saveSession(storage, input(session));
		expect((await getExercise(storage, 'ex_sidoplanka'))!.data.log).toHaveLength(1);
		expect(await getExercise(storage, 'ex_sidoplanka_2')).toBeNull();
	});

	it('saves the new exercise in the next workout version', async () => {
		const storage = await setup();
		const result = await saveSession(storage, input(withNew(), { saveAsNewVersion: true }));
		expect(result.newWorkoutVersion).toBe(2);
		const [workout] = await listLatestWorkouts(storage);
		expect(workout.exercises.map((e) => e.exerciseId)).toEqual(['ex_marklyft', 'ex_hantelrodd', 'ex_plankan']);
		expect(workout.changeNote).toBe('Byt Hantelpress mot Hantelrodd');
	});

	it('does not create an exercise without done sets, and drops its swap', async () => {
		const storage = await setup();
		const session = withNew();
		session.exercises[1].sets = [{ weight: 14, reps: 10, done: false }];
		await saveSession(storage, input(session));
		expect(await getExercise(storage, 'ex_hantelrodd')).toBeNull();
		expect((await getSession(storage, 's_20261006'))!.data.deviations).toEqual([]);
	});

	it('creates nothing when the save is going to fail', async () => {
		const storage = await setup();
		const none = withNew();
		for (const ex of none.exercises) ex.sets = ex.sets.map((set) => ({ ...set, done: false }));
		await expect(saveSession(storage, input(none, { saveAsNewVersion: true }))).rejects.toThrow(/Inga set/);
		const wrongType = withNew();
		wrongType.exercises[1].sets = [{ seconds: 30, done: true }];
		await expect(saveSession(storage, input(wrongType))).rejects.toThrow(/sets\[0\]\.weight/);
		await expect(saveSession(storage, input(withNew({ workoutVersion: 9 })))).rejects.toThrow(/finns inte/);
		expect(await getExercise(storage, 'ex_hantelrodd')).toBeNull();
	});

	it('keeps only the validated fields of a written-in exercise', () => {
		const parsed = input(withNew({ newExercises: [{ id: 'new_abc', ...rows, name: '  Hantel   rodd ', extra: 'x' } as never] }));
		expect(parsed.session.newExercises).toEqual([{ id: 'new_abc', name: 'Hantel rodd', type: 'weight', instruction: 'Rak rygg.' }]);
	});

	it('rejects invalid written-in exercises before anything is read', () => {
		expect(() => input(withNew({ newExercises: [{ id: 'ex_fel', ...rows }] }))).toThrow(/newExercises\[0\]\.id/);
		expect(() => input(withNew({ newExercises: [{ id: 'new_abc', ...rows, name: ' ' }] }))).toThrow(/namn/);
		expect(() => input(withNew({ newExercises: [{ id: 'new_abc', ...rows, type: 'cardio' as never }] }))).toThrow(/type/);
		expect(() => input(withNew({ newExercises: [{ id: 'new_abc', ...rows, name: `A${' '.repeat(500)}B` }] }))).toThrow(/högst 80/);
	});
});
