import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { BlobUserStorage } from './blob';
import type { UserStorage } from './types';

export type { UserStorage, StoredJson, StoredFileInfo, WriteOptions } from './types';
export { StorageConflictError } from './types';

/** Storage scoped to the signed-in user. Use this from routes. */
export function storageFor(locals: App.Locals): UserStorage {
	if (!locals.user) error(401, 'Inte inloggad');
	return new BlobUserStorage(locals.user.id, env.BLOB_READ_WRITE_TOKEN);
}
