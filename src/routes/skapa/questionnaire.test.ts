/** Route tests for Skapa's questionnaire (#102): what the page knows, and saving answers to the profile. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProfile, saveProfile } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';
import { StorageConflictError } from '$lib/server/storage/types';
import { env } from '../../test/env-private';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const skapa = await import('./+page.server');
const locals = { user: { id: 'u1', email: 'a@b.c', name: null } };

const saveFacts = (fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return skapa.actions.profile({ locals, request: new Request('https://milon.test/skapa?/profile', { method: 'POST', body }) } as never);
};

beforeEach(() => {
	state.storage = new MemoryUserStorage('u1');
	env.ANTHROPIC_API_KEY = 'test';
});
afterEach(() => {
	delete env.ANTHROPIC_API_KEY;
});

describe('the questionnaire in Skapa', () => {
	it('gets what Milon already knows from the profile', async () => {
		await saveProfile(state.storage, { coachContext: 'Tränar: på gym', rules: ['Inga hopp'] });
		const data = (await skapa.load({ locals, url: new URL('https://milon.test/skapa?steg=1') } as never)) as { known: unknown };
		expect(data.known).toEqual({ place: 'på gym', rules: ['Inga hopp'] });
	});

	it('saves only the answers that were sent, and keeps the rest of the profile', async () => {
		await saveProfile(state.storage, { goals: 'Starkare', coachContext: 'Tränar: på gym' });
		expect(await saveFacts({ place: 'hemma med hantlar', avoid: 'Ont i knät', experience: '  ' })).toEqual({ saved: true });
		expect((await getProfile(state.storage)).data).toEqual({ goals: 'Starkare', coachContext: 'Tränar: hemma med hantlar', rules: ['Ont i knät'] });
	});

	it('creates the profile if there is none', async () => {
		await saveFacts({ experience: 'ny på styrketräning' });
		expect((await getProfile(state.storage)).data).toEqual({ coachContext: 'Erfarenhet: ny på styrketräning' });
	});

	it('refuses answers past the limits and a profile changed at the same time', async () => {
		expect(((await saveFacts({ avoid: 'x'.repeat(301) })) as { status: number }).status).toBe(400);
		await saveProfile(state.storage, {});
		const write = state.storage.writeJson.bind(state.storage);
		state.storage.writeJson = async () => {
			throw new StorageConflictError('profile.json');
		};
		expect(((await saveFacts({ place: 'på gym' })) as { status: number }).status).toBe(409);
		state.storage.writeJson = write;
		expect((await getProfile(state.storage)).data).toEqual({});
	});
});
