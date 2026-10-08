import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../../model';
import { MemoryUserStorage } from '../storage/memory';
import {
	createExercise,
	getExercise,
	getSession,
	listLatestWorkouts,
	listSessionIds,
	parseSaveSessionInput,
	saveSession,
	saveWorkoutVersion
} from '.';

async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Marklyft', type: 'weight', loadClass: 'heavy', instruction: '' });
	await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
	await createExercise(storage, { name: 'Sidoplanka', type: 'time', instruction: '' });
	await createExercise(storage, { name: 'Hantelpress', type: 'weight', loadClass: 'light', instruction: '' });
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

	it('refuses a note that is too long', () => {
		const session = active();
		session.exercises[0].note = 'x'.repeat(1001);
		expect(() => input(session)).toThrow(/note/);
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
