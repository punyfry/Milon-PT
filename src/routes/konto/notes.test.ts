/** Route tests for what Milon knows on Konto (#110): removing a line and saving an approved proposal. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProfile, saveProfile } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const konto = await import('./+page.server');
const locals = { user: { id: 'u1', email: 'a@b.c', name: null } };

const post = (action: 'forget' | 'notes', fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return konto.actions[action]({ locals, request: new Request(`https://milon.test/konto?/${action}`, { method: 'POST', body }) } as never);
};

const base = { rules: ['Ont i knät', 'Inga hopp'], context: ['Tränar: på gym'] };

beforeEach(async () => {
	state.storage = new MemoryUserStorage('u1');
	await saveProfile(state.storage, { goals: 'Starkare', rules: base.rules, coachContext: 'Tränar: på gym' });
});

describe('what Milon knows on Konto (#110)', () => {
	it('is listed on the page', async () => {
		const data = (await konto.load({ locals } as never)) as { notes: unknown };
		expect(data.notes).toEqual(base);
	});

	it('removes one rule or line, and nothing when it is no longer there', async () => {
		expect(await post('forget', { kind: 'rules', text: 'Ont i knät' })).toEqual({ notesSaved: true });
		expect(await post('forget', { kind: 'context', text: 'Tränar: på gym' })).toEqual({ notesSaved: true });
		expect((await getProfile(state.storage)).data).toEqual({ goals: 'Starkare', rules: ['Inga hopp'] });
		expect(await post('forget', { kind: 'rules', text: 'Ont i knät' })).toMatchObject({ status: 409 });
		expect(await post('forget', { kind: 'goals', text: 'Starkare' })).toMatchObject({ status: 400 });
	});

	it('saves an approved proposal, keeping the rest of the profile', async () => {
		const proposal = { rules: ['Inga hopp'], context: ['Tränar: hemma med hantlar'] };
		expect(await post('notes', { base: JSON.stringify(base), proposal: JSON.stringify(proposal) })).toEqual({ notesSaved: true });
		expect((await getProfile(state.storage)).data).toEqual({ goals: 'Starkare', rules: ['Inga hopp'], coachContext: 'Tränar: hemma med hantlar' });
	});

	it('saves a proposal for a profile with duplicate rules', async () => {
		await saveProfile(state.storage, { rules: ['Inga hopp', 'Inga hopp'] }, (await getProfile(state.storage)).version);
		const data = (await konto.load({ locals } as never)) as { notes: unknown };
		const proposal = JSON.stringify({ rules: [], context: [] });
		expect(await post('notes', { base: JSON.stringify(data.notes), proposal })).toEqual({ notesSaved: true });
		expect((await getProfile(state.storage)).data).toEqual({});
	});

	it('saves nothing when the notes changed since the proposal, or the proposal is invalid', async () => {
		const proposal = JSON.stringify({ rules: [], context: [] });
		expect(await post('notes', { base: JSON.stringify({ ...base, rules: ['Ont i knät'] }), proposal })).toMatchObject({ status: 409 });
		expect(await post('notes', { base: JSON.stringify(base), proposal: '{' })).toMatchObject({ status: 400 });
		expect(await post('notes', { base: JSON.stringify(base), proposal: JSON.stringify({ rules: ['x'.repeat(301)], context: [] }) })).toMatchObject({
			status: 400
		});
		expect((await getProfile(state.storage)).data.rules).toEqual(base.rules);
	});
});
