/** Route tests for using the app without Milon: the coach setting, the builder redirect, building by hand and editing exercises. */
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../test/env-private';
import { createExercise, getExercise, getProfile, saveProfile, saveWorkoutVersion } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const konto = await import('./konto/+page.server');
const skapa = await import('./skapa/+page.server');
const manuell = await import('./skapa/manuell/+page.server');
const ovning = await import('./historik/ovning/[id]/+page.server');

const locals = { user: { id: 'u1', email: 'a@b.c', name: null } };
const event = (path: string, extra: Record<string, unknown> = {}) => ({ locals, url: new URL(`https://milon.test${path}`), params: {}, ...extra }) as never;
const form = (fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return new Request('https://milon.test/', { method: 'POST', body });
};

/** Runs a load or action and returns what it returned or threw. */
async function outcome(fn: () => unknown) {
	try {
		return { value: await fn() };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location, status: e.status };
		if (isHttpError(e)) return { status: e.status };
		throw e;
	}
}

beforeEach(async () => {
	state.storage = new MemoryUserStorage('u1');
	env.ANTHROPIC_API_KEY = 'test';
	await createExercise(state.storage, { name: 'Marklyft', type: 'weight', instruction: '' });
	await saveWorkoutVersion(state.storage, { slug: 'pass-a', name: 'Pass A', createdAt: '2026-10-01', exercises: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }] });
});

describe('the coach setting on the account page', () => {
	it('turns Milon off and on, and refuses anything else', async () => {
		await konto.actions.coach(event('/konto', { request: form({ coach: 'off' }) }));
		expect((await getProfile(state.storage)).data.coach).toBe(false);
		await konto.actions.coach(event('/konto', { request: form({ coach: 'on' }) }));
		expect((await getProfile(state.storage)).data.coach).toBe(true);
		const bad = (await konto.actions.coach(event('/konto', { request: form({ coach: 'kanske' }) }))) as { status: number };
		expect(bad.status).toBe(400);
	});
});

describe('/skapa without Milon', () => {
	it('leads to building by hand and keeps the workout being edited', async () => {
		await saveProfile(state.storage, { coach: false });
		expect(await outcome(() => skapa.load(event('/skapa')))).toEqual({ redirect: '/skapa/manuell', status: 307 });
		expect(await outcome(() => skapa.load(event('/skapa?pass=pass-a')))).toEqual({ redirect: '/skapa/manuell?pass=pass-a', status: 307 });
	});

	it('also leads there when no API key is set', async () => {
		delete env.ANTHROPIC_API_KEY;
		expect((await outcome(() => skapa.load(event('/skapa')))).redirect).toBe('/skapa/manuell');
	});
});

describe('/skapa/manuell', () => {
	it('loads the workout to edit with its versions, and 404 for an unknown one', async () => {
		const { value } = (await outcome(() => manuell.load(event('/skapa/manuell?pass=pass-a')))) as { value: Record<string, unknown> };
		expect(value.editing).toMatchObject({ slug: 'pass-a', version: 1, items: [{ exerciseId: 'ex_marklyft', sets: 3 }] });
		expect(value.versions).toEqual([{ version: 1, createdAt: '2026-10-01', changeNote: null, exerciseCount: 1 }]);
		expect(value.coach).toBe(true);
		expect(await outcome(() => manuell.load(event('/skapa/manuell?pass=finns-inte')))).toEqual({ status: 404 });
	});
});

describe('editing an exercise in History', () => {
	const edit = (id: string, fields: Record<string, string>) => ovning.actions.edit(event(`/historik/ovning/${id}`, { params: { id }, request: form(fields) }));

	it('saves the changes and reports problems as messages', async () => {
		await edit('ex_marklyft', { name: 'Marklyft (stång)', type: 'weight', instruction: 'Rak rygg.' });
		expect((await getExercise(state.storage, 'ex_marklyft'))!.data).toMatchObject({ name: 'Marklyft (stång)', instruction: 'Rak rygg.' });
		const locked = (await edit('ex_marklyft', { name: 'Marklyft', type: 'time', instruction: '' })) as { status: number; data: { editError: string } };
		expect(locked.status).toBe(400);
		expect(locked.data.editError).toMatch(/finns i ett pass \(Pass A\)/);
	});

	it('answers 404 for an invalid id', async () => {
		expect(await outcome(() => edit('../profile', { name: 'X', type: 'weight' }))).toEqual({ status: 404 });
	});
});
