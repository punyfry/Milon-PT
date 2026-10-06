/**
 * Storage interface for per-user JSON files. Everything the app persists goes
 * through this, so swapping Vercel Blob for e.g. Postgres later only touches
 * the implementation behind it.
 *
 * Paths are relative to the user's root (`users/<userId>/`), e.g.
 * `profile.json` or `exercises/ex_marklyft.json`. No method ever returns a
 * URL: reads always go through the server.
 */
export interface UserStorage {
	readonly userId: string;

	/** Returns null if the file doesn't exist. */
	readJson<T>(path: string): Promise<StoredJson<T> | null>;

	/**
	 * Writes a JSON file.
	 * - `ifMatch`: only write if the current version matches (optimistic locking).
	 * - `createOnly`: fail if the file already exists (e.g. new workout versions).
	 * Throws `StorageConflictError` when either condition fails.
	 */
	writeJson(path: string, data: unknown, options?: WriteOptions): Promise<{ version: string }>;

	/** Lists files under a prefix, e.g. `exercises/`. */
	list(prefix?: string): Promise<StoredFileInfo[]>;

	delete(path: string): Promise<void>;
}

export interface StoredJson<T> {
	data: T;
	/** Opaque version token, pass as `ifMatch` to guard the next write. */
	version: string;
}

export interface StoredFileInfo {
	/** Path relative to the user's root. */
	path: string;
	size: number;
	uploadedAt: Date;
	version: string;
}

export interface WriteOptions {
	ifMatch?: string;
	createOnly?: boolean;
}

export class StorageConflictError extends Error {
	constructor(path: string) {
		super(`Konflikt vid skrivning av ${path}`);
		this.name = 'StorageConflictError';
	}
}
