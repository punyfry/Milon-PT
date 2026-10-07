import { StorageConflictError, type UserStorage } from '../storage/types';

/** Standard för AI_DAILY_LIMIT: anrop till pass-byggaren och hjälparen per användare och dag. */
export const DEFAULT_DAILY_LIMIT = 200;

export class AiLimitError extends Error {
	constructor(readonly limit: number) {
		super(`Dagens gräns för Milon är nådd (${limit} frågor). Försök igen i morgon.`);
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
			return count + 1;
		} catch (e) {
			if (!(e instanceof StorageConflictError)) throw e;
		}
	}
	throw new StorageConflictError(path);
}
