import type { UserStorage } from '../storage/types';

/** Files deleted at the same time. */
const CONCURRENCY = 10;
/** Listing rounds, so a file written by another device during the deletion is caught too. */
const MAX_ROUNDS = 3;

/**
 * Deletes every file the user has: profile, exercises, workouts, sessions,
 * builder conversations and AI counters. Signing in again starts from scratch.
 * Returns the number of files deleted.
 */
export async function deleteAccount(storage: UserStorage): Promise<number> {
	let deleted = 0;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const paths = (await storage.list()).map((f) => f.path);
		if (!paths.length) return deleted;
		for (let i = 0; i < paths.length; i += CONCURRENCY) {
			await Promise.all(paths.slice(i, i + CONCURRENCY).map((p) => storage.delete(p)));
		}
		deleted += paths.length;
	}
	if ((await storage.list()).length) throw new Error('Files are still being written; the account could not be deleted completely');
	return deleted;
}
