import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { BlobUserStorage } from './blob';
import { e2eStorage } from './e2e';
import { LocalFileUserStorage } from './local';
import { RequestStorage, type StorageStats } from './request';
import type { UserStorage } from './types';

export type { UserStorage, StoredJson, StoredFileInfo, WriteOptions } from './types';
export { StorageConflictError } from './types';
export type { StorageStats } from './request';

/** Per-request state, keyed by the request's `locals` (one object per request). */
const requests = new WeakMap<App.Locals, { shareReads: boolean; storage?: RequestStorage }>();

/**
 * Called by the timing hook at the start of each request. Without it (tests,
 * scripts) `storageFor` returns the storage as is.
 */
export function beginRequest(locals: App.Locals, options: { shareReads: boolean }): void {
	requests.set(locals, { shareReads: options.shareReads });
}

/** Storage calls made during the request, or null if it made none. */
export function requestStats(locals: App.Locals): StorageStats | null {
	return requests.get(locals)?.storage?.stats ?? null;
}

/**
 * Storage scoped to the signed-in user. Use this from routes.
 * In dev without a Blob token, files are kept locally under `.data/`. The UI
 * tests run the dev server with `E2E_MEMORY_STORAGE=1` to keep them in memory.
 */
export function storageFor(locals: App.Locals): UserStorage {
	if (!locals.user) error(401, 'Inte inloggad');
	const request = requests.get(locals);
	if (!request) return userStorage(locals.user.id);
	if (request.storage?.userId !== locals.user.id) {
		request.storage = new RequestStorage(userStorage(locals.user.id), { shareReads: request.shareReads });
	}
	return request.storage;
}

function userStorage(userId: string): UserStorage {
	// Checked first so the UI tests never touch Blob, even with a token in `.env`.
	// `dev` is false in builds, so this can never be switched on in production.
	if (dev && env.E2E_MEMORY_STORAGE === '1') return e2eStorage(userId);
	if (env.BLOB_READ_WRITE_TOKEN) return new BlobUserStorage(userId, env.BLOB_READ_WRITE_TOKEN);
	if (dev) return new LocalFileUserStorage(userId);
	error(500, 'BLOB_READ_WRITE_TOKEN saknas');
}
