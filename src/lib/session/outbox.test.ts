import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardPendingSave, flushPendingSaves, pendingSaves, queueSave } from './outbox';

beforeEach(() => {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	});
});

const save = (sessionId: string) => ({ sessionId, workoutName: 'Pass A', body: { session: { sessionId } } });
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('köad sparning', () => {
	it('köar ett pass en gång och slänger det på begäran', () => {
		queueSave(save('s1'));
		queueSave(save('s1'));
		queueSave(save('s2'));
		expect(pendingSaves().map((p) => p.sessionId)).toEqual(['s1', 's2']);
		discardPendingSave('s1');
		expect(pendingSaves().map((p) => p.sessionId)).toEqual(['s2']);
	});

	it('skickar köade pass och tar bort dem som sparats', async () => {
		queueSave(save('s1'));
		queueSave(save('s2'));
		const fetcher = vi.fn(async () => reply(200));
		expect(await flushPendingSaves(fetcher as unknown as typeof fetch)).toEqual([]);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ session: { sessionId: 's1' } });
	});

	it('behåller passen vid nätfel och sparar serverns fel', async () => {
		queueSave(save('s1'));
		const offline = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(await flushPendingSaves(offline as unknown as typeof fetch)).toHaveLength(1);

		const rejected = vi.fn(async () => reply(400, { message: 'Inga set är markerade som klara' }));
		const [left] = await flushPendingSaves(rejected as unknown as typeof fetch);
		expect(left).toMatchObject({ sessionId: 's1', error: 'Inga set är markerade som klara' });

		const loggedOut = vi.fn(async () => reply(401));
		expect((await flushPendingSaves(loggedOut as unknown as typeof fetch))[0].error).toBe('Logga in igen för att spara');
	});
});
