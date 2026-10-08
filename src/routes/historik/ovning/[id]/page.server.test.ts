import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExercise, getExercise, saveWorkoutVersion } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const { actions } = await import('./+page.server');

/** Runs the delete action; a redirect comes back as `{ redirect }`. */
async function remove(id: string) {
	const event = { locals: { user: { id: 'u1' } }, params: { id }, request: new Request('https://milon.test/x', { method: 'POST' }) };
	try {
		return await actions.delete(event as never);
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		throw e;
	}
}

beforeEach(async () => {
	state.storage = new MemoryUserStorage('u1');
	await createExercise(state.storage, { name: 'Rodd', type: 'weight', instruction: '' });
	await createExercise(state.storage, { name: 'Knäböj', type: 'weight', instruction: '' });
	await saveWorkoutVersion(state.storage, {
		slug: 'pass-a',
		name: 'Pass A',
		createdAt: '2026-10-01',
		exercises: [{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } }]
	});
});

describe('deleting an exercise from its page (#46)', () => {
	it('deletes and goes back to the library', async () => {
		expect(await remove('ex_rodd')).toEqual({ redirect: '/historik' });
		expect((await getExercise(state.storage, 'ex_rodd'))!.data.deleted).toBe(true);
	});

	it('answers 400 with a message when a workout uses it or it is gone', async () => {
		expect(await remove('ex_knaboj')).toMatchObject({ status: 400, data: { deleteError: 'Övningen används i passet Pass A. Ta bort den ur passet först.' } });
		expect(await remove('ex_saknas')).toMatchObject({ status: 400, data: { deleteError: 'Övningen finns inte.' } });
		await expect(remove('../x')).rejects.toMatchObject({ status: 404 });
	});
});
