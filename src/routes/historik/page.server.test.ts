import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getExercise } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const { actions } = await import('./+page.server');

/** Runs the create action with form fields; a redirect comes back as `{ redirect }`. */
async function create(fields: Record<string, string>) {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	const event = { locals: { user: { id: 'u1' } }, request: new Request('https://milon.test/historik?/create', { method: 'POST', body }) };
	try {
		return await actions.create(event as never);
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		throw e;
	}
}

beforeEach(() => {
	state.storage = new MemoryUserStorage('u1');
});

describe('creating an exercise in the library (#64)', () => {
	it('creates it with its note and opens it', async () => {
		expect(await create({ name: 'Turkish get-up', type: 'weight', instruction: '', note: 'Såg den på gymmet' })).toEqual({
			redirect: '/historik/ovning/ex_turkish_get_up'
		});
		expect((await getExercise(state.storage, 'ex_turkish_get_up'))!.data.note).toBe('Såg den på gymmet');
	});

	it('answers 400 with a message for a taken name or a missing one', async () => {
		await create({ name: 'Rodd', type: 'weight' });
		expect(await create({ name: 'rodd', type: 'weight' })).toMatchObject({ status: 400, data: { createError: 'Det finns redan en övning som heter rodd.' } });
		expect(await create({ name: ' ', type: 'weight' })).toMatchObject({ status: 400, data: { createError: 'Övningen behöver ett namn.' } });
	});
});
