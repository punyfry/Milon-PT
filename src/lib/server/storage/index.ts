import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { BlobUserStorage } from './blob';
import { LocalFileUserStorage } from './local';
import type { UserStorage } from './types';

export type { UserStorage, StoredJson, StoredFileInfo, WriteOptions } from './types';
export { StorageConflictError } from './types';

/**
 * Storage scoped to the signed-in user. Use this from routes.
 * In dev without a Blob token, files are kept locally under `.data/`.
 */
export function storageFor(locals: App.Locals): UserStorage {
	if (!locals.user) error(401, 'Inte inloggad');
	if (env.BLOB_READ_WRITE_TOKEN) return new BlobUserStorage(locals.user.id, env.BLOB_READ_WRITE_TOKEN);
	if (dev) return new LocalFileUserStorage(locals.user.id);
	error(500, 'BLOB_READ_WRITE_TOKEN saknas');
}
