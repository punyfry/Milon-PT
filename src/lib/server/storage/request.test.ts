import { describe, expect, it, vi } from 'vitest';
import { MemoryUserStorage } from './memory';
import { RequestStorage } from './request';
import { StorageConflictError } from './types';

function setup(shareReads = true) {
	const inner = new MemoryUserStorage('u1');
	const spies = { read: vi.spyOn(inner, 'readJson'), list: vi.spyOn(inner, 'list') };
	return { inner, spies, storage: new RequestStorage(inner, { shareReads }) };
}

describe('RequestStorage', () => {
	it('shares identical reads and listings within a GET request, also while they are in flight', async () => {
		const { inner, spies, storage } = setup();
		await inner.writeJson('exercises/ex_a.json', { n: 1 });
		const [a, b] = await Promise.all([storage.readJson('exercises/ex_a.json'), storage.readJson('exercises/ex_a.json')]);
		await Promise.all([storage.list('exercises/'), storage.list('exercises/')]);
		expect(a).toEqual(b);
		expect(spies.read).toHaveBeenCalledTimes(1);
		expect(spies.list).toHaveBeenCalledTimes(1);
		expect(storage.stats).toMatchObject({ reads: 1, lists: 1, writes: 0, shared: 2 });
	});

	it('gives each caller its own copy of the data', async () => {
		const { inner, storage } = setup();
		await inner.writeJson('profile.json', { goal: 3 });
		const first = await storage.readJson<{ goal: number }>('profile.json');
		first!.data.goal = 99;
		expect((await storage.readJson<{ goal: number }>('profile.json'))!.data.goal).toBe(3);
	});

	it('reads and lists again after a write or delete', async () => {
		const { inner, spies, storage } = setup();
		await inner.writeJson('profile.json', { goal: 3 });
		await storage.readJson('profile.json');
		await storage.list('');
		await storage.writeJson('profile.json', { goal: 4 });
		expect((await storage.readJson<{ goal: number }>('profile.json'))!.data.goal).toBe(4);
		expect((await storage.list('')).length).toBe(1);
		await storage.delete('profile.json');
		expect(await storage.readJson('profile.json')).toBeNull();
		expect(await storage.list('')).toEqual([]);
		expect(spies.read).toHaveBeenCalledTimes(3);
		expect(spies.list).toHaveBeenCalledTimes(3);
		expect(storage.stats.writes).toBe(2);
	});

	it('reads again after a failed write, so a conflict retry sees the current version', async () => {
		const { inner, storage } = setup();
		const { version } = await inner.writeJson('profile.json', { goal: 3 });
		const stale = await storage.readJson('profile.json');
		await inner.writeJson('profile.json', { goal: 5 }, { ifMatch: version }); // someone else writes
		await expect(storage.writeJson('profile.json', { goal: 4 }, { ifMatch: stale!.version })).rejects.toBeInstanceOf(StorageConflictError);
		const fresh = await storage.readJson<{ goal: number }>('profile.json');
		expect(fresh!.data.goal).toBe(5);
		await expect(storage.writeJson('profile.json', { goal: 4 }, { ifMatch: fresh!.version })).resolves.toBeDefined();
	});

	it('shares the old read while a write is in flight, and reads again once it is done', async () => {
		const { inner, spies, storage } = setup();
		await inner.writeJson('profile.json', { goal: 3 });
		await storage.readJson('profile.json');
		const write = storage.writeJson('profile.json', { goal: 4 });
		expect((await storage.readJson<{ goal: number }>('profile.json'))!.data.goal).toBe(3);
		await write;
		expect((await storage.readJson<{ goal: number }>('profile.json'))!.data.goal).toBe(4);
		expect(spies.read).toHaveBeenCalledTimes(2);
	});

		it('does not keep a failed read', async () => {
		const { spies, storage } = setup();
		spies.read.mockRejectedValueOnce(new Error('network'));
		await expect(storage.readJson('profile.json')).rejects.toThrow('network');
		await expect(storage.readJson('profile.json')).resolves.toBeNull();
		expect(spies.read).toHaveBeenCalledTimes(2);
	});

	it('shares nothing outside GET requests', async () => {
		const { inner, spies, storage } = setup(false);
		await inner.writeJson('profile.json', { goal: 3 });
		await storage.readJson('profile.json');
		await storage.readJson('profile.json');
		await storage.list('');
		await storage.list('');
		expect(spies.read).toHaveBeenCalledTimes(2);
		expect(spies.list).toHaveBeenCalledTimes(2);
		expect(storage.stats).toMatchObject({ reads: 2, lists: 2, shared: 0 });
	});

	it('counts wall-clock time once for parallel calls', async () => {
		vi.useFakeTimers();
		try {
			const { inner, storage } = setup(false);
			const slow = () => new Promise<null>((r) => setTimeout(() => r(null), 100));
			vi.spyOn(inner, 'readJson').mockImplementation(slow);
			const both = Promise.all([storage.readJson('a.json'), storage.readJson('b.json')]);
			await vi.advanceTimersByTimeAsync(100);
			await both;
			expect(storage.stats.ms).toBeGreaterThanOrEqual(100);
			expect(storage.stats.ms).toBeLessThan(150);
		} finally {
			vi.useRealTimers();
		}
	});
});
