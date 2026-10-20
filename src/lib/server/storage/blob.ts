import {
	BlobError,
	BlobPreconditionFailedError,
	del,
	get,
	head,
	list,
	put,
	type ListBlobResultBlob
} from '@vercel/blob';
import { BlobContentCache } from './blob-cache';
import { resolvePath, userRoot } from './paths';
import {
	StorageConflictError,
	type StoredFileInfo,
	type StoredJson,
	type UserStorage,
	type WriteOptions
} from './types';

/** Shared by every request on this server instance; see BlobContentCache. */
const contents = new BlobContentCache(20_000_000);

/**
 * Vercel Blob implementation. Every blob is written with `access: 'private'`,
 * so it can't be fetched by URL without the store token. Blob URLs never
 * leave this module.
 */
export class BlobUserStorage implements UserStorage {
	readonly userId: string;
	readonly #root: string;
	readonly #token: string;
	/** ETag per pathname from this instance's listings, newest listing wins. */
	readonly #listed = new Map<string, string>();
	cacheHits = 0;

	constructor(userId: string, token: string | undefined) {
		if (!token) throw new Error('BLOB_READ_WRITE_TOKEN saknas');
		this.userId = userId;
		this.#root = userRoot(userId);
		this.#token = token;
	}

	async readJson<T>(path: string): Promise<StoredJson<T> | null> {
		const pathname = resolvePath(this.userId, path);
		const listed = this.#listed.get(pathname);
		const cached = listed === undefined ? null : contents.get(pathname, listed);
		if (cached) {
			this.cacheHits++;
			return { data: JSON.parse(cached.body) as T, version: cached.etag };
		}
		let file = await this.#get<T>(pathname);
		if (file && file.version.startsWith('W/')) {
			// A weak ETag (W/"…", from a compressed download) never matches a conditional
			// write. Take the version from head() first and read again, so the version is
			// never newer than the data: a write in between then fails instead of being lost.
			console.warn(`[storage] weak ETag on ${path}`);
			const version = await head(pathname, { token: this.#token }).then((h) => h.etag, () => null);
			file = await this.#get<T>(pathname);
			if (file && version) file.version = version;
		}
		return file;
	}

	/** Downloads uncompressed, so the ETag is the strong one that put() and ifMatch use. */
	async #get<T>(pathname: string): Promise<StoredJson<T> | null> {
		const result = await get(pathname, {
			access: 'private',
			useCache: false,
			headers: { 'accept-encoding': 'identity' },
			token: this.#token
		});
		if (!result || result.statusCode !== 200) return null;
		const body = await new Response(result.stream).text();
		contents.set(pathname, result.blob.etag, body);
		return { data: JSON.parse(body) as T, version: result.blob.etag };
	}

	async writeJson(
		path: string,
		data: unknown,
		options: WriteOptions = {}
	): Promise<{ version: string }> {
		const pathname = resolvePath(this.userId, path);
		const body = JSON.stringify(data, null, 2);
		try {
			const result = await put(pathname, body, {
				access: 'private',
				contentType: 'application/json',
				addRandomSuffix: false,
				allowOverwrite: !options.createOnly,
				ifMatch: options.ifMatch,
				cacheControlMaxAge: 60,
				token: this.#token
			});
			contents.set(pathname, result.etag, body);
			if (this.#listed.has(pathname)) this.#listed.set(pathname, result.etag);
			return { version: result.etag };
		} catch (e) {
			// The file changed since it was listed, so the next read must download it.
			this.#listed.delete(pathname);
			if (e instanceof BlobPreconditionFailedError) throw new StorageConflictError(path);
			// put throws a generic BlobError when the blob exists and overwrite isn't
			// allowed, so check whether that's what happened.
			if (options.createOnly && e instanceof BlobError && (await this.#exists(pathname))) {
				throw new StorageConflictError(path);
			}
			throw e;
		}
	}

	async #exists(pathname: string): Promise<boolean> {
		try {
			await head(pathname, { token: this.#token });
			return true;
		} catch {
			return false;
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
		// A file missing from the listing is gone, so forget what an earlier listing said about it.
		for (const pathname of this.#listed.keys()) if (pathname.startsWith(fullPrefix)) this.#listed.delete(pathname);
		for (const b of blobs) this.#listed.set(b.pathname, b.etag);

		return blobs.map((b) => ({
			path: b.pathname.slice(this.#root.length),
			size: b.size,
			uploadedAt: b.uploadedAt,
			version: b.etag
		}));
	}

	async delete(path: string): Promise<void> {
		const pathname = resolvePath(this.userId, path);
		this.#listed.delete(pathname);
		contents.delete(pathname);
		await del(pathname, { token: this.#token });
	}
}
