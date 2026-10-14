import { describe, expect, it } from 'vitest';
import { MemoryUserStorage } from '../storage/memory';
import type { UserStorage } from '../storage/types';
import { deleteAccount } from './account';
import { createExercise, saveProfile, saveWorkoutVersion } from '.';

async function seed(storage: UserStorage) {
	await saveProfile(storage, { coach: true, weeklySessionGoal: 3 });
	await createExercise(storage, { name: 'Marklyft', type: 'weight', instruction: '' });
	await saveWorkoutVersion(storage, {
		slug: 'pass-a',
		name: 'Pass A',
		createdAt: '2026-10-01',
		exercises: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }]
	});
	await storage.writeJson('usage/2026-10-14.json', { count: 3 });
}

describe('deleteAccount', () => {
	it("deletes every file the user has and nobody else's", async () => {
		const files = new Map();
		const user = new MemoryUserStorage('u1', files);
		// A user id that starts with the same characters must not be caught by the prefix.
		const other = new MemoryUserStorage('u10', files);
		await seed(user);
		await seed(other);
		const before = (await other.list()).map((f) => f.path).sort();

		expect(await deleteAccount(user)).toBe(4);
		expect(await user.list()).toEqual([]);
		expect((await other.list()).map((f) => f.path).sort()).toEqual(before);
	});

	it('does nothing for an account without files', async () => {
		expect(await deleteAccount(new MemoryUserStorage('u1'))).toBe(0);
	});

	it('deletes files written during the deletion, and gives up if writes keep coming', async () => {
		const storage = new MemoryUserStorage('u1');
		await seed(storage);
		let writes = 0;
		const racing: UserStorage = {
			userId: storage.userId,
			readJson: (p) => storage.readJson(p),
			writeJson: (p, d, o) => storage.writeJson(p, d, o),
			list: async (prefix) => {
				const listing = await storage.list(prefix);
				// Another device saves a file right after each of the first two listings.
				if (writes < 2) await storage.writeJson(`sessions/s_2026101${writes++}.json`, {});
				return listing;
			},
			delete: (p) => storage.delete(p)
		};
		await deleteAccount(racing);
		expect(await storage.list()).toEqual([]);

		const endless: UserStorage = {
			...racing,
			list: async (prefix) => {
				await storage.writeJson(`sessions/s_${crypto.randomUUID().slice(0, 8)}.json`, {});
				return storage.list(prefix);
			}
		};
		await expect(deleteAccount(endless)).rejects.toThrow();
	});
});
