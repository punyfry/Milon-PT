import {
	BlobPreconditionFailedError,
	del,
	get,
	list,
	put,
	type ListBlobResultBlob
} from '@vercel/blob';
import { env } from '$env/dynamic/private';
import { resolvePath, userRoot } from './paths';
import {
	StorageConflictError,
	type StoredFileInfo,
	type StoredJson,
	type UserStorage,
	type WriteOptions
} from './types';

/**
 * Vercel Blob implementation. Every blob is written with `access: 'private'`,
 * so it can't be fetched by URL without the store token. Blob URLs never
 * leave this module.
 */
export class BlobUserStorage implements UserStorage {
	readonly userId: string;
	readonly #root: string;

	constructor(userId: string) {
		this.userId = userId;
		this.#root = userRoot(userId);
	}

	get #token(): string {
		const token = env.BLOB_READ_WRITE_TOKEN;
		if (!token) throw new Error('BLOB_READ_WRITE_TOKEN saknas');
		return token;
	}

	async readJson<T>(path: string): Promise<StoredJson<T> | null> {
		const pathname = resolvePath(this.userId, path);
		const result = await get(pathname, {
			access: 'private',
			useCache: false,
			token: this.#token
		});
		if (!result || result.statusCode !== 200) return null;
		const data = (await new Response(result.stream).json()) as T;
		return { data, version: result.blob.etag };
	}

	async writeJson(
		path: string,
		data: unknown,
		options: WriteOptions = {}
	): Promise<{ version: string }> {
		const pathname = resolvePath(this.userId, path);
		try {
			const result = await put(pathname, JSON.stringify(data, null, 2), {
				access: 'private',
				contentType: 'application/json',
				addRandomSuffix: false,
				allowOverwrite: !options.createOnly,
				ifMatch: options.ifMatch,
				cacheControlMaxAge: 60,
				token: this.#token
			});
			return { version: result.etag };
		} catch (e) {
			if (e instanceof BlobPreconditionFailedError) throw new StorageConflictError(path);
			// put throws a generic BlobError when the blob exists and overwrite isn't allowed.
			if (options.createOnly && e instanceof Error && /already exists/i.test(e.message)) {
				throw new StorageConflictError(path);
			}
			throw e;
		}
	}

	async list(prefix = ''): Promise<StoredFileInfo[]> {
		const fullPrefix = resolvePath(this.userId, prefix, { file: false });
		const blobs: ListBlobResultBlob[] = [];
		let cursor: string | undefined;
		do {
			const page = await list({ prefix: fullPrefix, cursor, token: this.#token });
			blobs.push(...page.blobs);
			cursor = page.hasMore ? page.cursor : undefined;
		} while (cursor);

		return blobs.map((b) => ({
			path: b.pathname.slice(this.#root.length),
			size: b.size,
			uploadedAt: b.uploadedAt,
			version: b.etag
		}));
	}

	async delete(path: string): Promise<void> {
		await del(resolvePath(this.userId, path), { token: this.#token });
	}
}
