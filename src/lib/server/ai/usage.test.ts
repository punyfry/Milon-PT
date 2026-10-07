import { describe, expect, it } from 'vitest';
import { MemoryUserStorage } from '../storage/memory';
import { StorageConflictError } from '../storage/types';
import { AiLimitError, DEFAULT_DAILY_LIMIT, consumeAiCall, dailyLimit } from './usage';

describe('daglig AI-gräns', () => {
	it('läser gränsen ur miljövariabeln', () => {
		expect(dailyLimit(undefined)).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('abc')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('-1')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit('2.5')).toBe(DEFAULT_DAILY_LIMIT);
		expect(dailyLimit(' 50 ')).toBe(50);
		expect(dailyLimit('0')).toBe(0);
	});

	it('räknar per dag och stoppar vid gränsen', async () => {
		const storage = new MemoryUserStorage('u1');
		expect(await consumeAiCall(storage, '2026-10-07', 2)).toBe(1);
		expect(await consumeAiCall(storage, '2026-10-07', 2)).toBe(2);
		await expect(consumeAiCall(storage, '2026-10-07', 2)).rejects.toBeInstanceOf(AiLimitError);
		expect(await consumeAiCall(storage, '2026-10-08', 2)).toBe(1);
		await expect(consumeAiCall(storage, '2026-10-07', 0).catch((e) => e.message)).resolves.toMatch(/gräns/);
	});

	it('räknar rätt när flera anrop kommer samtidigt', async () => {
		const storage = new MemoryUserStorage('u1');
		const results = await Promise.allSettled(Array.from({ length: 4 }, () => consumeAiCall(storage, '2026-10-07', 10)));
		const counts = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
		expect(new Set(counts).size).toBe(counts.length);
		expect((await storage.readJson<{ count: number }>('usage/2026-10-07.json'))?.data.count).toBe(counts.length);
		for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(StorageConflictError);
	});
});
