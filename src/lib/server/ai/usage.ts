import { StorageConflictError, type UserStorage } from '../storage/types';

/** Standard för AI_DAILY_LIMIT: anrop till Claude API per användare och dag (en tur i pass-byggaren kan göra flera). */
export const DEFAULT_DAILY_LIMIT = 200;

export class AiLimitError extends Error {
	constructor(readonly limit: number) {
		super(`Dagens gräns för Milon är nådd (${limit} anrop). Försök igen i morgon.`);
		this.name = 'AiLimitError';
	}
}

/** Läser gränsen ur miljövariabeln. Saknas eller är den ogiltig gäller standard. */
export function dailyLimit(raw: string | undefined): number {
	const n = Number(raw?.trim());
	return raw?.trim() && Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT;
}

/**
 * Räknar ett AI-anrop för dagen (`usage/<YYYY-MM-DD>.json`) och kastar
 * AiLimitError när gränsen är nådd. Skrivningen skyddas med ifMatch, så
 * samtidiga anrop inte kan räkna fel; vid konflikt görs ett nytt försök.
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

/** Hur många anrop som återstår i dag. Räknar inget. */
export async function remainingAiCalls(storage: UserStorage, today: string, limit: number): Promise<number> {
	const current = await storage.readJson<{ count?: unknown }>(`usage/${today}.json`);
	const count = typeof current?.data.count === 'number' ? current.data.count : 0;
	return Math.max(0, limit - count);
}

const KEEP_DAYS = 30;

/** Tar bort räknare äldre än 30 dagar. Körs en gång per dag (när dagens fil skapas). */
async function pruneUsage(storage: UserStorage, today: string): Promise<void> {
	const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
	try {
		for (const file of await storage.list('usage/')) {
			const date = /^usage\/(\d{4}-\d{2}-\d{2})\.json$/.exec(file.path)?.[1];
			if (date && date < cutoff) await storage.delete(file.path);
		}
	} catch (e) {
		// Städningen får aldrig stoppa ett anrop.
		console.error('Kunde inte rensa gamla AI-räknare:', e);
	}
}
