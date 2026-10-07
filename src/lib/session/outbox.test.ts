import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardPendingSave, flushPendingSaves, pendingKey, pendingSaves, queueSave } from './outbox';

beforeEach(() => {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	});
});

const save = (sessionId: string, startedAt = '2026-10-07T07:00:00+02:00', userId = 'u1') => ({
	key: pendingKey(sessionId, startedAt),
	userId,
	workoutName: 'Pass A',
	body: { session: { sessionId, startedAt } }
});
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const asFetch = (f: unknown) => f as typeof fetch;

describe('queued saving', () => {
	it('keeps two sessions on the same day apart and discards on request', () => {
		queueSave(save('s_20261007'));
		queueSave(save('s_20261007'));
		queueSave(save('s_20261007', '2026-10-07T18:00:00+02:00'));
		expect(pendingSaves('u1')).toHaveLength(2);
		discardPendingSave(pendingKey('s_20261007', '2026-10-07T07:00:00+02:00'));
		expect(pendingSaves('u1').map((p) => p.key)).toEqual([pendingKey('s_20261007', '2026-10-07T18:00:00+02:00')]);
	});

	it('shows and sends only the sessions of the current account', async () => {
		queueSave(save('s1'));
		queueSave(save('s2', undefined, 'u2'));
		expect(pendingSaves('u1').map((p) => p.userId)).toEqual(['u1']);
		expect(pendingSaves(null)).toEqual([]);
		const fetcher = vi.fn(async () => reply(200));
		expect(await flushPendingSaves('u1', asFetch(fetcher))).toEqual([]);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).session.sessionId).toBe('s1');
		expect(pendingSaves('u2')).toHaveLength(1);
	});

	it('keeps sessions on network errors and stores server errors', async () => {
		queueSave(save('s1'));
		const offline = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(await flushPendingSaves('u1', asFetch(offline))).toHaveLength(1);

		const rejected = vi.fn(async () => reply(400, { message: 'Inga set är markerade som klara' }));
		const [left] = await flushPendingSaves('u1', asFetch(rejected));
		expect(left).toMatchObject({ error: 'Inga set är markerade som klara' });

		const loggedOut = vi.fn(async () => reply(401));
		expect((await flushPendingSaves('u1', asFetch(loggedOut)))[0].error).toBe('Logga in igen för att spara');
	});
});
