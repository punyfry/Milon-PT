import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../test/env-private';
import { createExercise, prependLogEntry, saveProfile } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
const createMessage = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));
vi.mock('$lib/server/ai/client', async (original) => {
	const actual = await original<typeof import('$lib/server/ai/client')>();
	// limitedCreateMessage defaults to the module's own createMessage, which this mock can't reach,
	// so it gets the mock passed in: no test ever calls the real API.
	return { ...actual, createMessage, limitedCreateMessage: (storage: never) => actual.limitedCreateMessage(storage, createMessage) };
});

const { POST: builder } = await import('./builder/+server');
const { POST: helper } = await import('./helper/+server');
const { POST: importer } = await import('./import/+server');
const { POST: sessions } = await import('./sessions/+server');
const { POST: workouts } = await import('./workouts/+server');
const { PUT: editSessionHandler, DELETE: deleteSessionHandler } = await import('./sessions/[id]/+server');

type Handler = (event: never) => Promise<Response>;

/** Calls an endpoint and returns status and JSON, even when it throws an HTTP error. */
async function call(handler: Handler, body: unknown, headers: Record<string, string> = {}, params: Record<string, string> = {}) {
	const request = new Request('https://milon.test/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const event = { request, locals: { user: { id: 'u1', email: 'a@b.c', name: null } }, params };
	try {
		const res = await handler(event as never);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, body: e.body };
		throw e;
	}
}

beforeEach(() => {
	state.storage = new MemoryUserStorage('u1');
	createMessage.mockReset();
	createMessage.mockRejectedValue(new Error('Claude ska inte anropas i testerna'));
	env.ANTHROPIC_API_KEY = 'test';
	delete env.AI_DAILY_LIMIT;
});

describe('POST /api/import', () => {
	it('rejects files that are too large based on Content-Length', async () => {
		const res = await call(importer as Handler, { data: {} }, { 'content-length': '2000000' });
		expect(res.status).toBe(413);
	});

	it('rejects invalid JSON and lists errors per path without writing', async () => {
		expect((await call(importer as Handler, '{nej')).status).toBe(400);
		const res = await call(importer as Handler, { data: { exercises: [{ name: '' }] } });
		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body)).toContain('exercises[0]');
		expect(await state.storage.list()).toEqual([]);
	});

	it('does a dry run without apply', async () => {
		const data = { exercises: [{ name: 'Planka', type: 'time', instruction: '', log: [] }], workouts: [] };
		const res = await call(importer as Handler, { data });
		expect(res.status).toBe(200);
		expect(await state.storage.list()).toEqual([]);
	});
});

describe('POST /api/sessions', () => {
	it('rejects malformed JSON and invalid sessions', async () => {
		expect((await call(sessions as Handler, 'x')).status).toBe(400);
		expect((await call(sessions as Handler, { session: {} })).status).toBe(400);
		expect(await state.storage.list()).toEqual([]);
	});

	it('refuses a workout that has not been started', async () => {
		const session = {
			preparing: true,
			sessionId: 's_20261007',
			workoutSlug: 'pass-a',
			workoutVersion: 1,
			startedAt: '2026-10-07T07:00:00+02:00',
			lastActivityAt: '2026-10-07T07:00:00+02:00',
			exercises: [{ exerciseId: 'ex_a', sets: [{ reps: 8, done: true }] }],
			deviations: []
		};
		const res = await call(sessions as Handler, { session, endedAt: '2026-10-07T07:30:00+02:00' });
		expect(res.status).toBe(400);
		expect(res.body.message).toMatch(/inte startat/);
		expect(await state.storage.list()).toEqual([]);
	});
});

describe('PUT and DELETE /api/sessions/[id]', () => {
	it('validates input and answers 404 for unknown sessions', async () => {
		const id = { id: 's_20261007' };
		expect((await call(editSessionHandler as Handler, 'x', {}, id)).status).toBe(400);
		expect((await call(editSessionHandler as Handler, { version: 'v', startTime: '99:00' }, {}, id)).status).toBe(400);
		const valid = { version: 'v', startTime: '10:00', end: '2026-10-07T11:00', kcalEstimate: null, exercises: [{ exerciseId: 'ex_a', sets: [{ reps: 5 }] }] };
		expect((await call(editSessionHandler as Handler, valid, {}, id)).status).toBe(404);
		expect((await call(deleteSessionHandler as Handler, {}, {}, id)).status).toBe(400);
		expect((await call(deleteSessionHandler as Handler, { version: 'v' }, {}, id)).status).toBe(404);
		expect(await state.storage.list()).toEqual([]);
	});

	it('edits and deletes a saved session', async () => {
		await createExercise(state.storage, { name: 'Armhävning', type: 'bodyweight', instruction: '' });
		await prependLogEntry(state.storage, 'ex_armhavning', { sessionId: 's_20261007', date: '2026-10-07', sets: [{ reps: 5 }] });
		await state.storage.writeJson('sessions/s_20261007.json', {
			id: 's_20261007',
			workoutSlug: 'pass-a',
			workoutVersion: 1,
			startedAt: '2026-10-07T10:00:00+02:00',
			endedAt: '2026-10-09T11:00:00+02:00',
			exerciseIds: ['ex_armhavning'],
			deviations: []
		});
		const id = { id: 's_20261007' };
		const { version } = (await state.storage.readJson('sessions/s_20261007.json'))!;
		const edit = { version, startTime: '10:00', end: '2026-10-07T11:00', kcalEstimate: 250, exercises: [{ exerciseId: 'ex_armhavning', sets: [{ reps: 6 }] }] };
		const res = await call(editSessionHandler as Handler, edit, {}, id);
		expect(res.status).toBe(200);
		expect(res.body.session).toMatchObject({ endedAt: '2026-10-07T11:00:00+02:00', kcalEstimate: 250 });
		expect((await call(editSessionHandler as Handler, edit, {}, id)).status).toBe(409); // the old version again
		const current = (await state.storage.readJson('sessions/s_20261007.json'))!.version;
		const del = await call(deleteSessionHandler as Handler, { version: current }, {}, id);
		expect(del).toEqual({ status: 200, body: { deleted: true } });
		expect(await state.storage.readJson('sessions/s_20261007.json')).toBeNull();
	});

	it('answers 409 when the session changed since it was loaded', async () => {
		await state.storage.writeJson('sessions/s_20261007.json', {
			id: 's_20261007',
			workoutSlug: 'pass-a',
			workoutVersion: 1,
			startedAt: '2026-10-07T10:00:00+02:00',
			endedAt: '2026-10-07T11:00:00+02:00',
			exerciseIds: [],
			deviations: []
		});
		const res = await call(deleteSessionHandler as Handler, { version: 'stale' }, {}, { id: 's_20261007' });
		expect(res.status).toBe(409);
		expect(res.body.message).toMatch(/Ladda om/);
	});
});

describe('POST /api/builder', () => {
	it('validates the message before anything is counted or sent', async () => {
		expect((await call(builder as Handler, { message: '  ' })).status).toBe(400);
		expect((await call(builder as Handler, { message: 'x'.repeat(2001) })).status).toBe(400);
		expect(await state.storage.list('usage/')).toEqual([]);
		expect(createMessage).not.toHaveBeenCalled();
	});

	it('responds 503 when the API key is missing', async () => {
		delete env.ANTHROPIC_API_KEY;
		expect((await call(builder as Handler, { message: 'Hej' })).status).toBe(503);
	});

	it('responds 403 when the user has turned Milon off, without counting or calling Claude', async () => {
		await saveProfile(state.storage, { coach: false });
		const res = await call(builder as Handler, { message: 'Hej' });
		expect(res.status).toBe(403);
		expect(res.body.message).toMatch(/Milon är avstängd/);
		expect(await state.storage.list('usage/')).toEqual([]);
		expect(createMessage).not.toHaveBeenCalled();
	});

	it('stops at the daily limit without calling Claude', async () => {
		env.AI_DAILY_LIMIT = '0';
		const res = await call(builder as Handler, { message: 'Hej' });
		expect(res.status).toBe(429);
		expect(res.body.message).toMatch(/gräns/);
		expect(createMessage).not.toHaveBeenCalled();
	});
});

describe('POST /api/helper', () => {
	it('responds 403 when the user has turned Milon off', async () => {
		await saveProfile(state.storage, { coach: false });
		const res = await call(helper as Handler, { question: 'Hur?' });
		expect(res.status).toBe(403);
		expect(createMessage).not.toHaveBeenCalled();
	});

	it('rejects invalid questions and stops at the daily limit', async () => {
		expect((await call(helper as Handler, { question: '' })).status).toBe(400);
		const session = {
			sessionId: 's_20261007',
			workoutSlug: 'pass-a',
			workoutVersion: 1,
			startedAt: '2026-10-07T07:00:00+02:00',
			lastActivityAt: '2026-10-07T07:10:00+02:00',
			exercises: [{ exerciseId: 'ex_planka', sets: [] }],
			deviations: []
		};
		env.AI_DAILY_LIMIT = '0';
		const res = await call(helper as Handler, { session, exerciseId: 'ex_planka', question: 'Hur?' });
		expect(res.status).toBe(429);
		expect(createMessage).not.toHaveBeenCalled();
	});
});

describe('POST /api/workouts', () => {
	it('saves a workout built by hand and answers 400 with messages for the user', async () => {
		await createExercise(state.storage, { name: 'Marklyft', type: 'weight', instruction: '' });
		const ok = await call(workouts as Handler, { name: 'Pass C', items: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }] });
		expect(ok).toEqual({ status: 200, body: { slug: 'pass-c', version: 1, saved: true } });
		const bad = await call(workouts as Handler, { name: '', items: [] });
		expect(bad.status).toBe(400);
		expect(bad.body.message).toBe('Passet behöver ett namn. Passet behöver minst en övning.');
		expect((await call(workouts as Handler, 'inte json')).status).toBe(400);
	});
});
