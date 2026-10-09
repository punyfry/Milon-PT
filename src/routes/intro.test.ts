/** Route tests for the intro: who is sent there, and what finishing or skipping it saves. */
import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExercise, getProfile, saveProfile } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const start = await import('./+page.server');
const intro = await import('./valkommen/+page.server');

const locals = { user: { id: 'u1', email: 'a@b.c', name: null } };
const loadStart = async () => {
	try {
		await start.load({ locals } as never);
		return null;
	} catch (e) {
		if (isRedirect(e)) return e.location;
		throw e;
	}
};
const done = (fields: Record<string, string> = {}) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return intro.actions.done({ locals, request: new Request('https://milon.test/valkommen', { method: 'POST', body }) } as never);
};

beforeEach(() => {
	state.storage = new MemoryUserStorage('u1');
});

describe('the intro', () => {
	it('is where a new user starts, until it is done', async () => {
		expect(await loadStart()).toBe('/valkommen');
		await done();
		expect(await loadStart()).toBeNull();
	});

	it('is not forced on someone who already has exercises or workouts', async () => {
		await createExercise(state.storage, { name: 'Marklyft', type: 'weight', instruction: '' });
		expect(await loadStart()).toBeNull();
	});

	it('saves the choice of Milon with the date, and skipping keeps the current setting', async () => {
		await done({ coach: 'off' });
		expect((await getProfile(state.storage)).data).toMatchObject({ coach: false, onboardedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

		await saveProfile(state.storage, { coach: true, onboardedAt: '2026-01-01' }, (await getProfile(state.storage)).version);
		await done();
		// Watching it again keeps the first date and the setting.
		expect((await getProfile(state.storage)).data).toEqual({ coach: true, onboardedAt: '2026-01-01' });
	});

	it('refuses anything but on or off', async () => {
		expect(((await done({ coach: 'kanske' })) as { status: number }).status).toBe(400);
		expect((await getProfile(state.storage)).data.onboardedAt).toBeUndefined();
	});
});
