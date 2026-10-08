import { describe, expect, it } from 'vitest';
import { MemoryUserStorage } from '../storage/memory';
import { StorageConflictError } from '../storage/types';
import {
	createSession,
	lastSessionBySlug,
	listSessionsBetween,
	createExercise,
	getExercise,
	getProfile,
	listLatestWorkouts,
	prependLogEntry,
	saveExercise,
	saveProfile,
	saveWorkoutVersion
} from '.';

describe('data layer', () => {
	it('creates exercises with unique ids', async () => {
		const storage = new MemoryUserStorage('u1');
		const a = await createExercise(storage, { name: 'Marklyft', type: 'weight', instruction: '' });
		const b = await createExercise(storage, { name: 'marklyft', type: 'weight', instruction: '' });
		expect(a.data.id).toBe('ex_marklyft');
		expect(b.data.id).toBe('ex_marklyft_2');
		expect((await getExercise(storage, 'ex_marklyft'))?.data.name).toBe('Marklyft');
	});

	it('prepends new log entries and guards against concurrent changes', async () => {
		const storage = new MemoryUserStorage('u1');
		const ex = await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
		await prependLogEntry(storage, ex.data.id, { date: '2026-10-01', sets: [{ seconds: 40 }] });
		const after = await prependLogEntry(storage, ex.data.id, { date: '2026-10-06', sets: [{ seconds: 45 }] });
		expect(after.data.log.map((l) => l.date)).toEqual(['2026-10-06', '2026-10-01']);
		await expect(saveExercise(storage, ex.data, ex.version)).rejects.toBeInstanceOf(StorageConflictError);
	});

	it('versions workouts and keeps older versions', async () => {
		const storage = new MemoryUserStorage('u1');
		const base = { slug: 'pass-b', name: 'Pass B', createdAt: '2026-10-06', exercises: [] };
		const v1 = await saveWorkoutVersion(storage, base);
		const v2 = await saveWorkoutVersion(storage, { ...base, changeNote: 'Ändrat' });
		await saveWorkoutVersion(storage, { ...base, slug: 'pass-a', name: 'Pass A' });
		expect([v1.version, v2.version]).toEqual([1, 2]);
		const files = (await storage.list('workouts/')).map((f) => f.path).sort();
		expect(files).toEqual(['workouts/pass-a.v1.json', 'workouts/pass-b.v1.json', 'workouts/pass-b.v2.json']);
		const latest = await listLatestWorkouts(storage);
		expect(latest.find((w) => w.slug === 'pass-b')?.version).toBe(2);
	});

	it('reads and saves the profile', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await getProfile(storage)).toEqual({ data: {} });
		const saved = await saveProfile(storage, { weeklySessionGoal: 3 });
		await saveProfile(storage, { weeklySessionGoal: 4 }, saved.version);
		expect((await getProfile(storage)).data.weeklySessionGoal).toBe(4);
		await expect(saveProfile(storage, {}, saved.version)).rejects.toBeInstanceOf(StorageConflictError);
	});

	it('refuses to read files of another user via the path', async () => {
		const storage = new MemoryUserStorage('u1');
		await expect(storage.readJson('../u2/profile.json')).rejects.toThrow(/Ogiltig sökväg/);
	});
});

describe('sessions', () => {
	const session = (id: string, slug: string, startedAt: string) => ({
		id,
		workoutSlug: slug,
		workoutVersion: 1,
		startedAt,
		endedAt: startedAt,
		exerciseIds: [],
		deviations: []
	});

	async function setup() {
		const storage = new MemoryUserStorage('u1');
		await createSession(storage, session('s_20260921', 'pass-a', '2026-09-21T12:00:00+02:00'));
		await createSession(storage, session('s_20260929', 'pass-b', '2026-09-29T08:00:00+02:00'));
		await createSession(storage, session('s_20260929_2', 'pass-a', '2026-09-29T18:00:00+02:00'));
		await createSession(storage, session('s_20261006', 'pass-a', '2026-10-06T18:00:00+02:00'));
		const reads: string[] = [];
		const read = storage.readJson.bind(storage);
		storage.readJson = (path) => (reads.push(path), read(path));
		return { storage, reads };
	}

	it('reads only the session files of the week', async () => {
		const { storage, reads } = await setup();
		const week = await listSessionsBetween(storage, '2026-09-29', '2026-10-06');
		expect(week.map((s) => s.id)).toEqual(['s_20260929_2', 's_20260929']);
		expect(reads).toHaveLength(2);
	});

	it('finds the latest session per template', async () => {
		const { storage } = await setup();
		const last = await lastSessionBySlug(storage, ['pass-a', 'pass-b', 'pass-c']);
		expect(Object.fromEntries(last)).toEqual({
			'pass-a': '2026-10-06T18:00:00+02:00',
			'pass-b': '2026-09-29T08:00:00+02:00'
		});
	});
});
