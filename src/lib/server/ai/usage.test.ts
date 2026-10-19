import { describe, expect, it } from 'vitest';
import { MemoryUserStorage } from '../storage/memory';
import { StorageConflictError } from '../storage/types';
import { env } from '../../../test/env-private';
import { limitedCreateMessage } from './client';
import type { CreateMessage } from './models';
import {
	AiLimitError,
	DEFAULT_DAILY_LIMIT,
	DEFAULT_STARTER_CALLS,
	consumeAiCall,
	dailyLimit,
	recordTokens,
	remainingAiCalls,
	starterCalls
} from './usage';
import { vi } from 'vitest';

describe('daily AI limit', () => {
	it('reads the limit from the environment variable', () => {
		expect(dailyLimit(undefined)).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('abc')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('-1')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('2.5')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit(' 50 ')).toBe(50);
		expect(dailyLimit('0')).toBe(0);
		expect(starterCalls(undefined)).toBe(DEFAULT_STARTER_CALLS);
		expect(starterCalls(' 20 ')).toBe(20);
		expect(starterCalls('0')).toBe(0);
	});

	it('counts per day and stops at the limit', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await consumeAiCall(storage, '2026-10-07', { daily: 2, starter: 0 })).toBe(1);
		expect(await consumeAiCall(storage, '2026-10-07', { daily: 2, starter: 0 })).toBe(2);
		await expect(consumeAiCall(storage, '2026-10-07', { daily: 2, starter: 0 })).rejects.toBeInstanceOf(AiLimitError);
		expect(await consumeAiCall(storage, '2026-10-08', { daily: 2, starter: 0 })).toBe(1);
		await expect(consumeAiCall(storage, '2026-10-07', { daily: 0, starter: 0 }).catch((e) => e.message)).resolves.toMatch(/gräns/);
	});

	it('counts correctly when several calls arrive at once', async () => {
		const storage = new MemoryUserStorage('u1');
		const results = await Promise.allSettled(
			Array.from({ length: 4 }, () => consumeAiCall(storage, '2026-10-07', { daily: 10, starter: 0 }))
		);
		const counts = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
		expect(new Set(counts).size).toBe(counts.length);
		expect((await storage.readJson<{ count: number }>('usage/2026-10-07.json'))?.data.count).toBe(counts.length);
		for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(StorageConflictError);
	});
});

describe('counting per Claude call', () => {
	it('counts every call and stops before calling Claude when the limit is reached', async () => {
		env.AI_DAILY_LIMIT = '2';
		env.AI_STARTER_CALLS = '0';
		const storage = new MemoryUserStorage('u1');
		const inner = vi.fn(async () => ({}) as never) as unknown as CreateMessage;
		const create = limitedCreateMessage(storage, inner);
		await create({} as never);
		await create({} as never);
		await expect(create({} as never)).rejects.toBeInstanceOf(AiLimitError);
		expect(inner).toHaveBeenCalledTimes(2);
		delete env.AI_DAILY_LIMIT;
		delete env.AI_STARTER_CALLS;
	});

	it('reports how many are left without counting', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await remainingAiCalls(storage, '2026-10-07', { daily: 3, starter: 0 })).toBe(3);
		await consumeAiCall(storage, '2026-10-07', { daily: 3, starter: 0 });
		expect(await remainingAiCalls(storage, '2026-10-07', { daily: 3, starter: 0 })).toBe(2);
		expect(await remainingAiCalls(storage, '2026-10-07', { daily: 3, starter: 0 })).toBe(2);
	});

	it('prunes counters older than 30 days when a new day starts', async () => {
		const storage = new MemoryUserStorage('u1');
		await consumeAiCall(storage, '2026-08-01', { daily: 5, starter: 0 });
		await consumeAiCall(storage, '2026-09-20', { daily: 5, starter: 0 });
		await consumeAiCall(storage, '2026-10-07', { daily: 5, starter: 0 });
		expect((await storage.list('usage/')).map((f) => f.path).sort()).toEqual([
			'usage/2026-09-20.json',
			'usage/2026-10-07.json',
			'usage/starter.json'
		]);
	});
});

describe('starter pot', () => {
	const limits = { daily: 2, starter: 3 };
	const starter = async (storage: MemoryUserStorage) => (await storage.readJson('usage/starter.json'))?.data;

	it('starts on the first call and is used once the day is used up', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await consumeAiCall(storage, '2026-10-07', limits)).toBe(1);
		expect(await starter(storage)).toEqual({ startedAt: '2026-10-07', used: 0 });
		expect(await remainingAiCalls(storage, '2026-10-07', limits)).toBe(4);
		await consumeAiCall(storage, '2026-10-07', limits);
		// The day's limit is reached; the next three calls come from the pot.
		for (const used of [1, 2, 3]) expect(await consumeAiCall(storage, '2026-10-07', limits)).toBe(used);
		expect(await remainingAiCalls(storage, '2026-10-07', limits)).toBe(0);
		await expect(consumeAiCall(storage, '2026-10-07', limits)).rejects.toBeInstanceOf(AiLimitError);
		// A new day has its own limit, but the pot stays used.
		expect(await consumeAiCall(storage, '2026-10-08', limits)).toBe(1);
		expect(await starter(storage)).toEqual({ startedAt: '2026-10-07', used: 3 });
	});

	it('lasts 14 days from the first call', async () => {
		const storage = new MemoryUserStorage('u1');
		await consumeAiCall(storage, '2026-10-01', limits);
		await storage.writeJson('usage/2026-10-14.json', { count: 2 });
		expect(await remainingAiCalls(storage, '2026-10-14', limits)).toBe(3);
		expect(await consumeAiCall(storage, '2026-10-14', limits)).toBe(1);
		await storage.writeJson('usage/2026-10-15.json', { count: 2 });
		expect(await remainingAiCalls(storage, '2026-10-15', limits)).toBe(0);
		await expect(consumeAiCall(storage, '2026-10-15', limits)).rejects.toBeInstanceOf(AiLimitError);
	});

	it('starts a missing pot when it is first needed, once', async () => {
		const storage = new MemoryUserStorage('u1');
		// The day began before the pot existed (or creating it failed).
		await storage.writeJson('usage/2026-10-07.json', { count: 2 });
		await expect(consumeAiCall(storage, '2026-10-07', { daily: 2, starter: 0 })).rejects.toBeInstanceOf(AiLimitError);
		expect(await starter(storage)).toBeUndefined();
		expect(await consumeAiCall(storage, '2026-10-07', limits)).toBe(1);
		expect(await starter(storage)).toEqual({ startedAt: '2026-10-07', used: 1 });
	});

	it('gives nothing with an invalid or future pot file, and nothing when turned off', async () => {
		const storage = new MemoryUserStorage('u1');
		await storage.writeJson('usage/2026-10-07.json', { count: 2 });
		await storage.writeJson('usage/starter.json', { startedAt: '2026-10-08', used: 0 });
		await expect(consumeAiCall(storage, '2026-10-07', limits)).rejects.toBeInstanceOf(AiLimitError);
		await storage.writeJson('usage/starter.json', { used: 'x' });
		await expect(consumeAiCall(storage, '2026-10-07', limits)).rejects.toBeInstanceOf(AiLimitError);
		await storage.writeJson('usage/starter.json', { startedAt: 7 });
		await expect(consumeAiCall(storage, '2026-10-07', limits)).rejects.toBeInstanceOf(AiLimitError);
		await storage.writeJson('usage/starter.json', { startedAt: '2026-10-07', used: 0 });
		await expect(consumeAiCall(storage, '2026-10-07', { daily: 2, starter: 0 })).rejects.toBeInstanceOf(AiLimitError);
		expect(await consumeAiCall(storage, '2026-10-07', limits)).toBe(1);
	});

	it('never hands out more than the pot when calls arrive at once', async () => {
		const storage = new MemoryUserStorage('u1');
		await storage.writeJson('usage/starter.json', { startedAt: '2026-10-07', used: 0 });
		await storage.writeJson('usage/2026-10-07.json', { count: 2 });
		const results = await Promise.allSettled(Array.from({ length: 6 }, () => consumeAiCall(storage, '2026-10-07', limits)));
		const ok = results.filter((r) => r.status === 'fulfilled').length;
		expect(ok).toBeLessThanOrEqual(3);
		expect(((await starter(storage)) as { used: number }).used).toBe(ok);
	});

	it('hands out the last call in the pot only once', async () => {
		const storage = new MemoryUserStorage('u1');
		await storage.writeJson('usage/starter.json', { startedAt: '2026-10-07', used: 2 });
		await storage.writeJson('usage/2026-10-07.json', { count: 2 });
		const results = await Promise.allSettled([1, 2].map(() => consumeAiCall(storage, '2026-10-07', limits)));
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(((await starter(storage)) as { used: number }).used).toBe(3);
	});
});

describe('token usage (#98)', () => {
	const day = 'usage/2026-10-07.json';
	const usage = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: null };

	it('adds up tokens per model next to the call count, and the count keeps them', async () => {
		const storage = new MemoryUserStorage('u1');
		await consumeAiCall(storage, '2026-10-07', { daily: 5, starter: 0 });
		await recordTokens(storage, '2026-10-07', 'claude-sonnet-5-5', usage);
		await recordTokens(storage, '2026-10-07', 'claude-sonnet-5-5', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900 });
		await recordTokens(storage, '2026-10-07', 'claude-haiku-4-5', { input_tokens: 7, output_tokens: 3 });
		await consumeAiCall(storage, '2026-10-07', { daily: 5, starter: 0 });
		expect((await storage.readJson(day))!.data).toEqual({
			count: 2,
			tokens: {
				'claude-sonnet-5-5': { calls: 2, input: 1010, output: 205, cacheWrite: 50, cacheRead: 900 },
				'claude-haiku-4-5': { calls: 1, input: 7, output: 3, cacheWrite: 0, cacheRead: 0 }
			}
		});
	});

	it('groups an unexpected model id as other, ignores invalid numbers and a missing usage', async () => {
		const storage = new MemoryUserStorage('u1');
		await recordTokens(storage, '2026-10-07', '../profile', { input_tokens: -5, output_tokens: Number.NaN });
		await recordTokens(storage, '2026-10-07', 'claude-haiku-4-5', undefined);
		expect((await storage.readJson(day))!.data).toEqual({ tokens: { other: { calls: 1, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } } });
	});

	it('counts correctly when several responses arrive at once', async () => {
		const storage = new MemoryUserStorage('u1');
		await consumeAiCall(storage, '2026-10-07', { daily: 5, starter: 0 });
		await Promise.all([1, 2, 3].map(() => recordTokens(storage, '2026-10-07', 'claude-haiku-4-5', usage)));
		const data = (await storage.readJson<{ count: number; tokens: Record<string, { calls: number; input: number }> }>(day))!.data;
		expect(data.count).toBe(1);
		expect(data.tokens['claude-haiku-4-5']).toMatchObject({ calls: 3, input: 3000 });
	});

	it('never fails the call when recording fails', async () => {
		const storage = new MemoryUserStorage('u1');
		storage.writeJson = async () => {
			throw new Error('network');
		};
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(recordTokens(storage, '2026-10-07', 'claude-haiku-4-5', usage)).resolves.toBeUndefined();
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it('gives up quietly after repeated conflicts', async () => {
		const storage = new MemoryUserStorage('u1');
		storage.writeJson = async (path) => {
			throw new StorageConflictError(path);
		};
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(recordTokens(storage, '2026-10-07', 'claude-haiku-4-5', usage)).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledWith('Could not record AI token usage:', expect.any(StorageConflictError));
		error.mockRestore();
	});

	it('records nothing when the call fails, but still counts it', async () => {
		const storage = new MemoryUserStorage('u1');
		const inner = vi.fn(async () => {
			throw new Error('overloaded');
		}) as unknown as CreateMessage;
		await expect(limitedCreateMessage(storage, inner)({ model: 'claude-sonnet-5-5' } as never)).rejects.toThrow('overloaded');
		const dayFile = (await storage.list('usage/')).find((f) => /\d{4}-\d{2}-\d{2}\.json$/.test(f.path))!;
		expect((await storage.readJson(dayFile.path))!.data).toEqual({ count: 1 });
	});

	it('records the served model of each limited call', async () => {
		const storage = new MemoryUserStorage('u1');
		const inner = vi.fn(async () => ({ model: 'claude-haiku-4-5', usage })) as unknown as CreateMessage;
		const response = await limitedCreateMessage(storage, inner)({ model: 'claude-sonnet-5-5' } as never);
		expect(response).toEqual({ model: 'claude-haiku-4-5', usage });
		const files = await storage.list('usage/');
		const dayFile = files.find((f) => /\d{4}-\d{2}-\d{2}\.json$/.test(f.path))!;
		const data = (await storage.readJson<{ count: number; tokens: Record<string, unknown> }>(dayFile.path))!.data;
		expect(data.count).toBe(1);
		expect(Object.keys(data.tokens)).toEqual(['claude-haiku-4-5']);
	});
});
