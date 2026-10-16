import type { UserStorage } from '../storage/types';

/** Files deleted at the same time. */
const CONCURRENCY = 10;
/** Listing rounds, so a file written by another device during the deletion is caught too. */
const MAX_ROUNDS = 3;

/**
 * The AI counters (a count per day, pruned after 30 days) and the starter pot
 * (`usage/starter.json`) are kept, so deleting the account and signing in again
 * resets neither the daily limit nor the pot.
 */
const KEPT = 'usage/';

/** The user's files that deleting the account removes. */
async function accountFiles(storage: UserStorage): Promise<string[]> {
	return (await storage.list()).map((f) => f.path).filter((p) => !p.startsWith(KEPT));
}

/**
 * Deletes every file the user has except the AI counters and starter pot: profile, exercises,
 * workouts, sessions and builder conversations. Signing in again starts from
 * scratch. Returns the number of deletions made.
 */
export async function deleteAccount(storage: UserStorage): Promise<number> {
	let deleted = 0;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const paths = await accountFiles(storage);
		if (!paths.length) return deleted;
		for (let i = 0; i < paths.length; i += CONCURRENCY) {
			await Promise.all(paths.slice(i, i + CONCURRENCY).map((p) => storage.delete(p)));
		}
		deleted += paths.length;
	}
	if ((await accountFiles(storage)).length) throw new Error('Files are still being written; the account could not be deleted completely');
	return deleted;
}
