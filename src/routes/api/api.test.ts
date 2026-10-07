import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../test/env-private';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
const createMessage = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));
vi.mock('$lib/server/ai/client', async (original) => ({
	...(await original<typeof import('$lib/server/ai/client')>()),
	createMessage
}));

const { POST: builder } = await import('./builder/+server');
const { POST: helper } = await import('./helper/+server');
const { POST: importer } = await import('./import/+server');
const { POST: sessions } = await import('./sessions/+server');

type Handler = (event: never) => Promise<Response>;

/** Calls an endpoint and returns status and JSON, even when it throws an HTTP error. */
async function call(handler: Handler, body: unknown, headers: Record<string, string> = {}) {
	const request = new Request('https://milon.test/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const event = { request, locals: { user: { id: 'u1', email: 'a@b.c', name: null } }, params: {} };
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

	it('stops at the daily limit without calling Claude', async () => {
		env.AI_DAILY_LIMIT = '0';
		const res = await call(builder as Handler, { message: 'Hej' });
		expect(res.status).toBe(429);
		expect(res.body.message).toMatch(/gräns/);
		expect(createMessage).not.toHaveBeenCalled();
	});
});

describe('POST /api/helper', () => {
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
