import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../model';
import { MemoryUserStorage } from '../storage/memory';
import { StorageConflictError } from '../storage/types';
import {
	createExercise,
	deleteSession,
	editSession,
	getExercise,
	getSession,
	getSessionDetail,
	parseEditSessionInput,
	prependLogEntry,
	saveExercise,
	saveSession,
	saveWorkoutVersion,
	type EditSessionInput
} from '.';

const now = new Date('2026-10-08T12:00:00Z');

/** A saved session on 6 Oct (Marklyft and Plankan done), plus an older Marklyft entry from another session. */
async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Marklyft', type: 'weight', loadClass: 'heavy', instruction: '' });
	await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
	await createExercise(storage, { name: 'Armhävning', type: 'bodyweight', instruction: '' });
	await saveWorkoutVersion(storage, {
		slug: 'pass-b',
		name: 'Pass B',
		createdAt: '2026-10-01',
		exercises: [
			{ exerciseId: 'ex_marklyft', sets: 2, target: { reps: 8 } },
			{ exerciseId: 'ex_plankan', sets: 1, target: { seconds: 45 } }
		]
	});
	await prependLogEntry(storage, 'ex_marklyft', { sessionId: 's_20261001', date: '2026-10-01', sets: [{ weight: 30, reps: 8 }] });
	await saveSession(storage, {
		session: {
			sessionId: 's_20261006',
			workoutSlug: 'pass-b',
			workoutVersion: 1,
			startedAt: '2026-10-06T17:10:00+02:00',
			lastActivityAt: '2026-10-06T18:00:00+02:00',
			exercises: [
				{ exerciseId: 'ex_marklyft', sets: [{ weight: 40, reps: 8, done: true }, { weight: 45, reps: 6, done: true }] },
				{ exerciseId: 'ex_plankan', sets: [{ seconds: 45, done: true }] }
			],
			deviations: []
		},
		endedAt: '2026-10-08T09:30:00+02:00', // forgot to finish
		kcalEstimate: 300,
		saveAsNewVersion: false
	});
	const detail = (await getSessionDetail(storage, 's_20261006'))!;
	return { storage, detail };
}

function input(version: string, overrides: Partial<EditSessionInput> = {}): EditSessionInput {
	return parseEditSessionInput({
		version,
		startTime: '17:10',
		end: '2026-10-06T18:05',
		kcalEstimate: 300,
		exercises: [
			{ exerciseId: 'ex_marklyft', sets: [{ weight: 40, reps: 8 }, { weight: 45, reps: 6 }] },
			{ exerciseId: 'ex_plankan', sets: [{ seconds: 45 }] }
		],
		...overrides
	});
}

describe('session detail', () => {
	it('reads the record with each exercise and its sets from the log', async () => {
		const { detail } = await setup();
		expect(detail.workoutName).toBe('Pass B');
		expect(detail.exercises).toEqual([
			{ id: 'ex_marklyft', name: 'Marklyft', type: 'weight', loadClass: 'heavy', sets: [{ weight: 40, reps: 8 }, { weight: 45, reps: 6 }] },
			{ id: 'ex_plankan', name: 'Plankan', type: 'time', sets: [{ seconds: 45 }] }
		]);
	});

	it('returns null for unknown or invalid ids', async () => {
		const { storage } = await setup();
		expect(await getSessionDetail(storage, 's_20990101')).toBeNull();
		expect(await getSessionDetail(storage, '../x')).toBeNull();
	});
});

describe('editing a session', () => {
	it('corrects the end time across days and keeps an untouched start time as it was', async () => {
		const { storage, detail } = await setup();
		const updated = await editSession(storage, 's_20261006', input(detail.version), now);
		expect(updated).toMatchObject({ startedAt: '2026-10-06T17:10:00+02:00', endedAt: '2026-10-06T18:05:00+02:00', kcalEstimate: 300 });
		expect((await getSession(storage, 's_20261006'))!.data.endedAt).toBe('2026-10-06T18:05:00+02:00');
	});

	it('changes the start time on the same day, with the Stockholm offset of that date', async () => {
		const { storage, detail } = await setup();
		const updated = await editSession(storage, 's_20261006', input(detail.version, { startTime: '16:45', end: '2026-10-27T10:00' }), new Date('2026-11-01T12:00:00Z'));
		expect(updated?.startedAt).toBe('2026-10-06T16:45:00+02:00');
		expect(updated?.endedAt).toBe('2026-10-27T10:00:00+01:00'); // winter time
	});

	it('changes sets, adds a missed set and leaves other sessions alone', async () => {
		const { storage, detail } = await setup();
		await editSession(
			storage,
			's_20261006',
			input(detail.version, {
				exercises: [
					{ exerciseId: 'ex_marklyft', sets: [{ weight: 42.5, reps: 8 }, { weight: 45, reps: 6 }, { weight: 45, reps: 5 }] },
					{ exerciseId: 'ex_plankan', sets: [{ seconds: 45 }] }
				]
			}),
			now
		);
		const log = (await getExercise(storage, 'ex_marklyft'))!.data.log;
		expect(log).toEqual([
			{ sessionId: 's_20261006', date: '2026-10-06', sets: [{ weight: 42.5, reps: 8 }, { weight: 45, reps: 6 }, { weight: 45, reps: 5 }] },
			{ sessionId: 's_20261001', date: '2026-10-01', sets: [{ weight: 30, reps: 8 }] }
		]);
	});

	it('removes an exercise from the session and its log', async () => {
		const { storage, detail } = await setup();
		const updated = await editSession(storage, 's_20261006', input(detail.version, { exercises: [{ exerciseId: 'ex_marklyft', sets: [{ weight: 40, reps: 8 }] }] }), now);
		expect(updated?.exerciseIds).toEqual(['ex_marklyft']);
		expect((await getExercise(storage, 'ex_plankan'))!.data.log).toEqual([]);
		expect((await getSessionDetail(storage, 's_20261006'))!.exercises.map((e) => e.id)).toEqual(['ex_marklyft']);
	});

	it('can clear the kcal estimate', async () => {
		const { storage, detail } = await setup();
		const updated = await editSession(storage, 's_20261006', input(detail.version, { kcalEstimate: null }), now);
		expect(updated).not.toHaveProperty('kcalEstimate');
	});

	it('refuses a stale version, an end before the start or in the future, foreign exercises and wrong set types', async () => {
		const { storage, detail } = await setup();
		await expect(editSession(storage, 's_20261006', input('old'), now)).rejects.toBeInstanceOf(StorageConflictError);
		await expect(editSession(storage, 's_20261006', input(detail.version, { end: '2026-10-06T17:00' }), now)).rejects.toThrow(/efter starttiden/);
		await expect(editSession(storage, 's_20261006', input(detail.version, { end: '2026-10-09T12:00' }), now)).rejects.toThrow(/framtiden/);
		await expect(
			editSession(storage, 's_20261006', input(detail.version, { exercises: [{ exerciseId: 'ex_armhavning', sets: [{ reps: 5 }] }] }), now)
		).rejects.toThrow(/ingår inte/);
		await expect(
			editSession(storage, 's_20261006', input(detail.version, { exercises: [{ exerciseId: 'ex_plankan', sets: [{ reps: 5 }] }] }), now)
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			editSession(storage, 's_20261006', input(detail.version, { exercises: [{ exerciseId: 'ex_marklyft', sets: [{ weight: 4000, reps: 5 }] }] }), now)
		).rejects.toThrow(/Orimligt/);
		// Nothing was written by the refused edits.
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log[0].sets).toEqual([{ weight: 40, reps: 8 }, { weight: 45, reps: 6 }]);
		expect((await getSession(storage, 's_20261006'))!.version).toBe(detail.version);
	});

	it('checks the shape before anything is read', () => {
		expect(() => parseEditSessionInput({ version: 'v', startTime: '25:00', end: '2026-10-06', kcalEstimate: -1, exercises: [] })).toThrow(
			/starttid[\s\S]*sluttid[\s\S]*Kcal[\s\S]*minst en övning/
		);
		expect(() =>
			parseEditSessionInput({ version: 'v', startTime: '10:00', end: '2026-10-06T11:00', kcalEstimate: null, exercises: [{ exerciseId: 'ex_a', sets: [] }] })
		).toThrow(/minst ett set/);
	});

	it('returns null for a session that does not exist', async () => {
		const { storage, detail } = await setup();
		expect(await editSession(storage, 's_20990101', input(detail.version), now)).toBeNull();
	});
});

describe('a queued save arriving after an edit', () => {
	/** The same save again, as the outbox would send it if the first response was lost. */
	const retry = (storage: MemoryUserStorage) =>
		saveSession(storage, {
			session: {
				sessionId: 's_20261006',
				workoutSlug: 'pass-b',
				workoutVersion: 1,
				startedAt: '2026-10-06T17:10:00+02:00',
				lastActivityAt: '2026-10-06T18:00:00+02:00',
				exercises: [
					{ exerciseId: 'ex_marklyft', sets: [{ weight: 40, reps: 8, done: true }, { weight: 45, reps: 6, done: true }] },
					{ exerciseId: 'ex_plankan', sets: [{ seconds: 45, done: true }] }
				],
				deviations: []
			},
			endedAt: '2026-10-08T09:30:00+02:00',
			kcalEstimate: 300,
			saveAsNewVersion: false
		});

	it('is recognised as already saved after the start time was changed', async () => {
		const { storage, detail } = await setup();
		const edited = await editSession(storage, 's_20261006', input(detail.version, { startTime: '16:50' }), now);
		expect(edited).toMatchObject({ startedAt: '2026-10-06T16:50:00+02:00', originalStartedAt: '2026-10-06T17:10:00+02:00' });
		expect(await retry(storage)).toMatchObject({ sessionId: 's_20261006', alreadySaved: true });
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log).toHaveLength(2);
	});

	it('keeps the original start through several edits', async () => {
		const { storage, detail } = await setup();
		await editSession(storage, 's_20261006', input(detail.version, { startTime: '16:50' }), now);
		const second = (await getSessionDetail(storage, 's_20261006'))!;
		const edited = await editSession(storage, 's_20261006', input(second.version, { startTime: '16:40' }), now);
		expect(edited?.originalStartedAt).toBe('2026-10-06T17:10:00+02:00');
	});

	it('does not bring back an exercise removed from the session', async () => {
		const { storage, detail } = await setup();
		await editSession(storage, 's_20261006', input(detail.version, { exercises: [{ exerciseId: 'ex_marklyft', sets: [{ weight: 40, reps: 8 }] }] }), now);
		expect(await retry(storage)).toMatchObject({ alreadySaved: true });
		expect((await getExercise(storage, 'ex_plankan'))!.data.log).toEqual([]);
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log[0].sets).toEqual([{ weight: 40, reps: 8 }]);
	});
});

describe('edge cases', () => {
	it('rejects malformed input', () => {
		const ok = { version: 'v', startTime: '10:00', end: '2026-10-06T11:00', kcalEstimate: null, exercises: [{ exerciseId: 'ex_a', sets: [{ reps: 1 }] }] };
		expect(() => parseEditSessionInput('x')).toThrow();
		expect(() => parseEditSessionInput({ ...ok, version: '' })).toThrow(/Versionen/);
		expect(() => parseEditSessionInput({ ...ok, version: 'v'.repeat(201) })).toThrow(/Versionen/);
		expect(() => parseEditSessionInput({ ...ok, exercises: [ok.exercises[0], ok.exercises[0]] })).toThrow(/exercises\[1\]/);
		expect(() => parseEditSessionInput({ ...ok, exercises: [{ exerciseId: '../x', sets: [{ reps: 1 }] }] })).toThrow(/exercises\[0\]/);
		expect(parseEditSessionInput({ ...ok, kcalEstimate: 312.6 }).kcalEstimate).toBe(313);
	});

	it('returns null or false for invalid ids', async () => {
		const { storage, detail } = await setup();
		expect(await editSession(storage, '../x', input(detail.version), now)).toBeNull();
		expect(await deleteSession(storage, '../x', detail.version)).toBe(false);
	});

	it('refuses an exercise whose file is gone', async () => {
		const { storage, detail } = await setup();
		await storage.delete('exercises/ex_plankan.json');
		await expect(editSession(storage, 's_20261006', input(detail.version), now)).rejects.toThrow(/finns inte/);
	});

	it('puts back a missing log entry in date order, and the detail skips exercises without one', async () => {
		const { storage } = await setup();
		const ex = (await getExercise(storage, 'ex_marklyft'))!;
		await saveExercise(storage, { ...ex.data, log: ex.data.log.filter((l) => l.sessionId !== 's_20261006') }, ex.version);
		const detail = (await getSessionDetail(storage, 's_20261006'))!;
		expect(detail.exercises.map((e) => e.id)).toEqual(['ex_plankan']);
		await editSession(storage, 's_20261006', input(detail.version), now);
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log.map((l) => l.date)).toEqual(['2026-10-06', '2026-10-01']);
	});

	it('gives up with a conflict if an exercise keeps changing underneath', async () => {
		const { storage, detail } = await setup();
		const write = storage.writeJson.bind(storage);
		storage.writeJson = async (path, data, options) => {
			if (path === 'exercises/ex_marklyft.json') throw new StorageConflictError(path);
			return write(path, data, options);
		};
		await expect(
			editSession(storage, 's_20261006', input(detail.version, { exercises: [{ exerciseId: 'ex_marklyft', sets: [{ weight: 50, reps: 1 }] }] }), now)
		).rejects.toBeInstanceOf(StorageConflictError);
	});
});

describe('deleting a session', () => {
	it('removes the record and its log entries, but not other sessions', async () => {
		const { storage, detail } = await setup();
		expect(await deleteSession(storage, 's_20261006', detail.version)).toBe(true);
		expect(await getSession(storage, 's_20261006')).toBeNull();
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log.map((l) => l.sessionId)).toEqual(['s_20261001']);
		expect((await getExercise(storage, 'ex_plankan'))!.data.log).toEqual([]);
		expect(await deleteSession(storage, 's_20261006', detail.version)).toBe(false);
	});

	it('refuses a stale version', async () => {
		const { storage } = await setup();
		await expect(deleteSession(storage, 's_20261006', 'old')).rejects.toBeInstanceOf(StorageConflictError);
		expect(await getSession(storage, 's_20261006')).not.toBeNull();
	});
});
