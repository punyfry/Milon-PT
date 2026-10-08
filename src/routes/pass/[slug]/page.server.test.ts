import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExercise, saveWorkoutVersion } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const { load } = await import('./+page.server');

type LoadResult = { exercises: { id: string }[]; catalog: { id: string; name: string; lastEntry?: unknown }[] };

async function run(search = '') {
	const event = { locals: { user: { id: 'u1' } }, params: { slug: 'pass-a' }, url: new URL(`https://milon.test/pass/pass-a${search}`) };
	return (await load(event as never)) as unknown as LoadResult;
}

beforeEach(async () => {
	state.storage = new MemoryUserStorage('u1');
	const s = state.storage;
	const log = [
		{ date: '2026-10-05', sets: [{ reps: 8 }] },
		{ date: '2026-10-01', sets: [{ reps: 6 }] }
	];
	await createExercise(s, { name: 'Dips', type: 'bodyweight', instruction: '', log });
	await createExercise(s, { name: 'Bänkpress', type: 'weight', instruction: '' });
	await createExercise(s, { name: 'Gammal', type: 'bodyweight', instruction: '', archived: true });
	await createExercise(s, { name: 'Arkiverad extra', type: 'bodyweight', instruction: '', archived: true });
	await saveWorkoutVersion(s, {
		slug: 'pass-a',
		name: 'Pass A',
		createdAt: '2026-10-01',
		exercises: [
			{ exerciseId: 'ex_dips', sets: 3, target: { reps: 8 } },
			{ exerciseId: 'ex_gammal', sets: 2, target: { reps: 5 } }
		]
	});
});

describe('/pass/[slug] load', () => {
	it('sends the non-archived catalog in Swedish order, with only the latest log entry', async () => {
		const { catalog } = await run();
		expect(catalog.map((e) => e.name)).toEqual(['Bänkpress', 'Dips']);
		expect(catalog.find((e) => e.id === 'ex_dips')?.lastEntry).toEqual({ date: '2026-10-05', sets: [{ reps: 8 }] });
		expect(JSON.stringify(catalog)).not.toContain('2026-10-01');
	});

	it('adds archived exercises from the workout and ?ex= next to the catalog, and drops unknown ids', async () => {
		expect((await run()).exercises.map((e) => e.id)).toEqual(['ex_gammal']);
		const { exercises } = await run('?ex=ex_arkiverad_extra,ex_finns_inte,../x');
		expect(exercises.map((e) => e.id)).toEqual(['ex_gammal', 'ex_arkiverad_extra']);
	});
});

describe('helper availability', () => {
	it('follows the API key and the coach setting', async () => {
		const { env } = await import('../../../test/env-private');
		const { saveProfile } = await import('$lib/server/data');
		env.ANTHROPIC_API_KEY = 'test';
		const available = async () => ((await run()) as unknown as { helperAvailable: boolean }).helperAvailable;
		expect(await available()).toBe(true);
		await saveProfile(state.storage, { coach: false });
		expect(await available()).toBe(false);
		delete env.ANTHROPIC_API_KEY;
		await saveProfile(state.storage, { coach: true }, (await state.storage.readJson('profile.json'))!.version);
		expect(await available()).toBe(false);
	});
});
