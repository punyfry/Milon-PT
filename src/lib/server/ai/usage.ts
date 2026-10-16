import { StorageConflictError, type UserStorage } from '../storage/types';

/** Default for AI_DAILY_LIMIT: Claude API calls per user and day (one builder turn can make several). */
export const DEFAULT_DAILY_LIMIT = 50;

export class AiLimitError extends Error {
	constructor(readonly limit: number) {
		super(`Dagens gräns för Milon är nådd (${limit} anrop). Försök igen i morgon.`);
		this.name = 'AiLimitError';
	}
}

/** Default for AI_STARTER_CALLS: extra calls for a new user's first days, used once the day's limit is reached. */
export const DEFAULT_STARTER_CALLS = 100;
/** How long the starter pot lasts, counted from the user's first AI call. */
export const STARTER_DAYS = 14;

/**
 * The starter pot (`usage/starter.json`): building the first workouts takes more calls than
 * later use, so a new user gets extra calls for their first two weeks. It is kept when the
 * account is deleted (like the daily counters), so starting over doesn't give a new pot.
 */
const STARTER_PATH = 'usage/starter.json';

interface Starter {
	/** Date of the user's first counted AI call. */
	startedAt: string;
	/** Calls taken from the pot. */
	used: number;
}

export interface AiLimits {
	/** Calls per day. */
	daily: number;
	/** Calls in the starter pot. */
	starter: number;
}

/** Reads a limit from an environment variable; falls back to the default if missing or invalid. */
function limitFrom(raw: string | undefined, fallback: number): number {
	const n = Number(raw?.trim());
	return raw?.trim() && Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function dailyLimit(raw: string | undefined): number {
	return limitFrom(raw, DEFAULT_DAILY_LIMIT);
}

export function starterCalls(raw: string | undefined): number {
	return limitFrom(raw, DEFAULT_STARTER_CALLS);
}

function count(data: { count?: unknown } | undefined): number {
	return typeof data?.count === 'number' ? data.count : 0;
}

/** The pot, if the file is valid. Anything else counts as an empty pot. */
function parseStarter(data: unknown): Starter | null {
	const s = data as Partial<Starter> | null;
	return s && typeof s.startedAt === 'string' && typeof s.used === 'number' ? { startedAt: s.startedAt, used: s.used } : null;
}

/** Calls left in the pot today: none once STARTER_DAYS have passed since it started. */
function starterLeft(starter: Starter | null, today: string, calls: number): number {
	if (!starter) return 0;
	const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${starter.startedAt}T12:00:00Z`)) / 86_400_000;
	return days >= 0 && days < STARTER_DAYS ? Math.max(0, calls - starter.used) : 0;
}

/**
 * Counts one AI call for the day (`usage/<YYYY-MM-DD>.json`). Once the day's limit is
 * reached the call is taken from the starter pot instead, and AiLimitError is thrown when
 * that is empty or has expired too. Writes are guarded with ifMatch/createOnly so concurrent
 * calls can't miscount; on conflict it retries. Returns the day's count, or the pot's.
 */
export async function consumeAiCall(storage: UserStorage, today: string, limits: AiLimits): Promise<number> {
	const path = `usage/${today}.json`;
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const current = await storage.readJson<{ count?: unknown }>(path);
			const n = count(current?.data);
			if (n < limits.daily) {
				await storage.writeJson(path, { count: n + 1 }, current ? { ifMatch: current.version } : { createOnly: true });
				if (!current) await startDay(storage, today);
				return n + 1;
			}
			return await consumeStarterCall(storage, today, limits);
		} catch (e) {
			if (!(e instanceof StorageConflictError)) throw e;
		}
	}
	throw new StorageConflictError(path);
}

/** Takes one call from the starter pot, or throws AiLimitError. */
async function consumeStarterCall(storage: UserStorage, today: string, limits: AiLimits): Promise<number> {
	const current = await storage.readJson<unknown>(STARTER_PATH);
	const starter = parseStarter(current?.data);
	if (!current || !starter || starterLeft(starter, today, limits.starter) === 0) throw new AiLimitError(limits.daily);
	await storage.writeJson(STARTER_PATH, { ...starter, used: starter.used + 1 }, { ifMatch: current.version });
	return starter.used + 1;
}

/**
 * Runs once a day, when the day's counter is created: starts the pot on the user's
 * first AI call and prunes old counters.
 */
async function startDay(storage: UserStorage, today: string): Promise<void> {
	try {
		await storage.writeJson(STARTER_PATH, { startedAt: today, used: 0 } satisfies Starter, { createOnly: true });
	} catch (e) {
		// Already started (the usual case).
		if (!(e instanceof StorageConflictError)) console.error('Could not start the AI starter pot:', e);
	}
	await pruneUsage(storage, today);
}

/** How many calls are left today, the starter pot included. Counts nothing. */
export async function remainingAiCalls(storage: UserStorage, today: string, limits: AiLimits): Promise<number> {
	const [day, starter] = await Promise.all([
		storage.readJson<{ count?: unknown }>(`usage/${today}.json`),
		storage.readJson<unknown>(STARTER_PATH)
	]);
	return Math.max(0, limits.daily - count(day?.data)) + starterLeft(parseStarter(starter?.data), today, limits.starter);
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
