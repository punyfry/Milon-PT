import { describe, expect, it } from 'vitest';
import { MemoryUserStorage } from '../storage/memory';
import { StorageConflictError } from '../storage/types';
import {
	createExercise,
	getExercise,
	getProfile,
	listLatestWorkouts,
	prependLogEntry,
	saveExercise,
	saveProfile,
	saveWorkoutVersion
} from '.';

describe('datalagret', () => {
	it('skapar övningar med unika id', async () => {
		const storage = new MemoryUserStorage('u1');
		const a = await createExercise(storage, { name: 'Marklyft', type: 'weight', loadClass: 'heavy', instruction: '' });
		const b = await createExercise(storage, { name: 'marklyft', type: 'weight', loadClass: 'heavy', instruction: '' });
		expect(a.data.id).toBe('ex_marklyft');
		expect(b.data.id).toBe('ex_marklyft_2');
		expect((await getExercise(storage, 'ex_marklyft'))?.data.name).toBe('Marklyft');
	});

	it('lägger nya loggposter först och skyddar mot samtidiga ändringar', async () => {
		const storage = new MemoryUserStorage('u1');
		const ex = await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
		await prependLogEntry(storage, ex.data.id, { date: '2026-10-01', sets: [{ seconds: 40 }] });
		const after = await prependLogEntry(storage, ex.data.id, { date: '2026-10-06', sets: [{ seconds: 45 }] });
		expect(after.data.log.map((l) => l.date)).toEqual(['2026-10-06', '2026-10-01']);
		await expect(saveExercise(storage, ex.data, ex.version)).rejects.toBeInstanceOf(StorageConflictError);
	});

	it('versionerar pass och behåller äldre versioner', async () => {
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

	it('läser och sparar profilen', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await getProfile(storage)).toEqual({ data: {} });
		const saved = await saveProfile(storage, { weeklySessionGoal: 3 });
		await saveProfile(storage, { weeklySessionGoal: 4 }, saved.version);
		expect((await getProfile(storage)).data.weeklySessionGoal).toBe(4);
		await expect(saveProfile(storage, {}, saved.version)).rejects.toBeInstanceOf(StorageConflictError);
	});

	it('vägrar läsa en annan användares filer via sökvägen', async () => {
		const storage = new MemoryUserStorage('u1');
		await expect(storage.readJson('../u2/profile.json')).rejects.toThrow(/Ogiltig sökväg/);
	});
});
