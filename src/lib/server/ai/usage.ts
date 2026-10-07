import { StorageConflictError, type UserStorage } from '../storage/types';

/** Default for AI_DAILY_LIMIT: Claude API calls per user and day (one builder turn can make several). */
export const DEFAULT_DAILY_LIMIT = 200;

export class AiLimitError extends Error {
	constructor(readonly limit: number) {
		super(`Dagens gräns för Milon är nådd (${limit} anrop). Försök igen i morgon.`);
		this.name = 'AiLimitError';
	}
}

/** Reads the limit from the environment variable; falls back to the default if missing or invalid. */
export function dailyLimit(raw: string | undefined): number {
	const n = Number(raw?.trim());
	return raw?.trim() && Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT;
}

/**
 * Counts one AI call for the day (`usage/<YYYY-MM-DD>.json`) and throws
 * AiLimitError once the limit is reached. The write is guarded with ifMatch
 * so concurrent calls can't miscount; on conflict it retries.
 */
export async function consumeAiCall(storage: UserStorage, today: string, limit: number): Promise<number> {
	const path = `usage/${today}.json`;
	for (let attempt = 0; attempt < 5; attempt++) {
		const current = await storage.readJson<{ count?: unknown }>(path);
		const count = typeof current?.data.count === 'number' ? current.data.count : 0;
		if (count >= limit) throw new AiLimitError(limit);
		try {
			await storage.writeJson(path, { count: count + 1 }, current ? { ifMatch: current.version } : { createOnly: true });
			if (!current) await pruneUsage(storage, today);
			return count + 1;
		} catch (e) {
			if (!(e instanceof StorageConflictError)) throw e;
		}
	}
	throw new StorageConflictError(path);
}

/** How many calls are left today. Counts nothing. */
export async function remainingAiCalls(storage: UserStorage, today: string, limit: number): Promise<number> {
	const current = await storage.readJson<{ count?: unknown }>(`usage/${today}.json`);
	const count = typeof current?.data.count === 'number' ? current.data.count : 0;
	return Math.max(0, limit - count);
}

const KEEP_DAYS = 30;

/** Deletes counters older than 30 days. Runs once a day (when today's file is created). */
async function pruneUsage(storage: UserStorage, today: string): Promise<void> {
	const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
	try {
		for (const file of await storage.list('usage/')) {
			const date = /^usage\/(\d{4}-\d{2}-\d{2})\.json$/.exec(file.path)?.[1];
			if (date && date < cutoff) await storage.delete(file.path);
		}
	} catch (e) {
		// Cleanup must never block a call.
		console.error('Could not prune old AI usage counters:', e);
	}
}
