import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobUserStorage } from './blob';
import { MemoryUserStorage } from './memory';
import { resolvePath, userRoot } from './paths';
import { StorageConflictError } from './types';

const blob = vi.hoisted(() => ({
	put: vi.fn(),
	get: vi.fn(),
	head: vi.fn(),
	list: vi.fn(),
	del: vi.fn()
}));

vi.mock('@vercel/blob', async (original) => ({ ...(await original<typeof import('@vercel/blob')>()), ...blob }));

describe('paths', () => {
	it("puts everything under the user's own folder", () => {
		expect(userRoot('u1')).toBe('users/u1/');
		expect(resolvePath('u1', 'exercises/ex_a.json')).toBe('users/u1/exercises/ex_a.json');
		expect(resolvePath('u1', 'exercises/', { file: false })).toBe('users/u1/exercises/');
		expect(resolvePath('u1', '', { file: false })).toBe('users/u1/');
	});

	it('rejects paths that could reach another user or anything but JSON', () => {
		for (const bad of ['../u2/profile.json', 'a/../../u2/profile.json', './profile.json', '/users/u2/profile.json', 'exercises//x.json', 'profile.txt', 'profile', '.hidden.json', 'a\\b.json', 'å.json', '%2e%2e/x.json']) {
			expect(() => resolvePath('u1', bad), bad).toThrow();
		}
		for (const badId of ['', '../u2', 'u1/x', 'u 1', 'a'.repeat(129)]) expect(() => userRoot(badId), badId).toThrow();
	});
});

describe('memory storage', () => {
	it('keeps users apart even when they share the same file map', async () => {
		const files = new Map();
		const a = new MemoryUserStorage('a', files);
		const b = new MemoryUserStorage('b', files);
		await a.writeJson('profile.json', { goals: 'a' });
		expect(await b.readJson('profile.json')).toBeNull();
		expect((await b.list()).length).toBe(0);
	});

	it('honours ifMatch and createOnly', async () => {
		const s = new MemoryUserStorage('a');
		const { version } = await s.writeJson('x.json', 1);
		await expect(s.writeJson('x.json', 2, { createOnly: true })).rejects.toBeInstanceOf(StorageConflictError);
		await expect(s.writeJson('x.json', 2, { ifMatch: 'fel' })).rejects.toBeInstanceOf(StorageConflictError);
		await s.writeJson('x.json', 2, { ifMatch: version });
		expect((await s.readJson('x.json'))?.data).toBe(2);
	});
});

describe('Vercel Blob storage', () => {
	beforeEach(() => {
		for (const fn of Object.values(blob)) fn.mockReset();
	});

	it('requires a token', () => {
		expect(() => new BlobUserStorage('u1', undefined)).toThrow(/BLOB_READ_WRITE_TOKEN/);
	});

	it("always writes privately, under the user's folder and with the token", async () => {
		blob.put.mockResolvedValue({ etag: 'e1', url: 'https://hemlig.blob/x' });
		const s = new BlobUserStorage('u1', 'token');
		expect(await s.writeJson('profile.json', { a: 1 }, { ifMatch: 'e0' })).toEqual({ version: 'e1' });
		const [pathname, , options] = blob.put.mock.calls[0];
		expect(pathname).toBe('users/u1/profile.json');
		expect(options).toMatchObject({ access: 'private', addRandomSuffix: false, ifMatch: 'e0', token: 'token', allowOverwrite: true });
		await s.writeJson('ny.json', {}, { createOnly: true });
		expect(blob.put.mock.calls[1][2].allowOverwrite).toBe(false);
	});

	it('reads privately and never returns the blob URL', async () => {
		blob.get.mockResolvedValue({
			statusCode: 200,
			stream: new Response(JSON.stringify({ goals: 'x' })).body,
			blob: { etag: 'e1', url: 'https://hemlig.blob/x' }
		});
		const s = new BlobUserStorage('u1', 'token');
		const read = await s.readJson('profile.json');
		expect(read).toEqual({ data: { goals: 'x' }, version: 'e1' });
		expect(JSON.stringify(read)).not.toContain('hemlig');
		expect(blob.get.mock.calls[0]).toEqual(['users/u1/profile.json', { access: 'private', useCache: false, token: 'token' }]);
	});

	it('takes the version from head() when the read has a weak ETag, so a conditional write can match', async () => {
		blob.get.mockResolvedValue({ statusCode: 200, stream: new Response('{}').body, blob: { etag: 'W/"e1"', url: 'https://hemlig.blob/x' } });
		blob.head.mockResolvedValue({ etag: '"e1"', url: 'https://hemlig.blob/x' });
		const read = await new BlobUserStorage('u1', 'token').readJson('builder/b_abcdef.json');
		expect(read?.version).toBe('"e1"');
		expect(blob.head.mock.calls[0]).toEqual(['users/u1/builder/b_abcdef.json', { token: 'token' }]);
	});

	it("lists only the user's prefix and strips it from the path", async () => {
		blob.list.mockResolvedValue({
			blobs: [{ pathname: 'users/u1/exercises/ex_a.json', size: 2, uploadedAt: new Date(0), etag: 'e', url: 'https://hemlig.blob/a' }],
			hasMore: false
		});
		const files = await new BlobUserStorage('u1', 'token').list('exercises/');
		expect(blob.list.mock.calls[0][0]).toMatchObject({ prefix: 'users/u1/exercises/', token: 'token' });
		expect(files.map((f) => f.path)).toEqual(['exercises/ex_a.json']);
		expect(JSON.stringify(files)).not.toContain('hemlig');
	});

	it("refuses paths outside the user's folder before any call is made", async () => {
		const s = new BlobUserStorage('u1', 'token');
		await expect(s.readJson('../u2/profile.json')).rejects.toThrow();
		await expect(s.writeJson('../u2/profile.json', {})).rejects.toThrow();
		await expect(s.delete('../u2/profile.json')).rejects.toThrow();
		expect(blob.get).not.toHaveBeenCalled();
		expect(blob.put).not.toHaveBeenCalled();
		expect(blob.del).not.toHaveBeenCalled();
	});
});
