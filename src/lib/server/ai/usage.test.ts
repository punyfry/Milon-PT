import { describe, expect, it } from 'vitest';
import { MemoryUserStorage } from '../storage/memory';
import { StorageConflictError } from '../storage/types';
import { env } from '../../../test/env-private';
import { limitedCreateMessage } from './client';
import type { CreateMessage } from './models';
import { AiLimitError, DEFAULT_DAILY_LIMIT, consumeAiCall, dailyLimit, remainingAiCalls } from './usage';
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
	});

	it('counts per day and stops at the limit', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await consumeAiCall(storage, '2026-10-07', 2)).toBe(1);
		expect(await consumeAiCall(storage, '2026-10-07', 2)).toBe(2);
		await expect(consumeAiCall(storage, '2026-10-07', 2)).rejects.toBeInstanceOf(AiLimitError);
		expect(await consumeAiCall(storage, '2026-10-08', 2)).toBe(1);
		await expect(consumeAiCall(storage, '2026-10-07', 0).catch((e) => e.message)).resolves.toMatch(/gräns/);
	});

	it('counts correctly when several calls arrive at once', async () => {
		const storage = new MemoryUserStorage('u1');
		const results = await Promise.allSettled(Array.from({ length: 4 }, () => consumeAiCall(storage, '2026-10-07', 10)));
		const counts = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
		expect(new Set(counts).size).toBe(counts.length);
		expect((await storage.readJson<{ count: number }>('usage/2026-10-07.json'))?.data.count).toBe(counts.length);
		for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(StorageConflictError);
	});
});

describe('counting per Claude call', () => {
	it('counts every call and stops before calling Claude when the limit is reached', async () => {
		env.AI_DAILY_LIMIT = '2';
		const storage = new MemoryUserStorage('u1');
		const inner = vi.fn(async () => ({}) as never) as unknown as CreateMessage;
		const create = limitedCreateMessage(storage, inner);
		await create({} as never);
		await create({} as never);
		await expect(create({} as never)).rejects.toBeInstanceOf(AiLimitError);
		expect(inner).toHaveBeenCalledTimes(2);
		delete env.AI_DAILY_LIMIT;
	});

	it('reports how many are left without counting', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await remainingAiCalls(storage, '2026-10-07', 3)).toBe(3);
		await consumeAiCall(storage, '2026-10-07', 3);
		expect(await remainingAiCalls(storage, '2026-10-07', 3)).toBe(2);
		expect(await remainingAiCalls(storage, '2026-10-07', 3)).toBe(2);
	});

	it('prunes counters older than 30 days when a new day starts', async () => {
		const storage = new MemoryUserStorage('u1');
		await consumeAiCall(storage, '2026-08-01', 5);
		await consumeAiCall(storage, '2026-09-20', 5);
		await consumeAiCall(storage, '2026-10-07', 5);
		expect((await storage.list('usage/')).map((f) => f.path).sort()).toEqual(['usage/2026-09-20.json', 'usage/2026-10-07.json']);
	});
});
