import { resolvePath, userRoot } from './paths';
import {
	StorageConflictError,
	type StoredFileInfo,
	type StoredJson,
	type UserStorage,
	type WriteOptions
} from './types';

/**
 * In-memory implementation med samma semantik som Blob-implementationen
 * (sökvägsvalidering, ifMatch, createOnly). Används i tester och för
 * torrkörning av importen.
 */
export class MemoryUserStorage implements UserStorage {
	readonly userId: string;
	readonly #files: Map<string, { body: string; version: string; uploadedAt: Date }>;
	#counter = 0;

	constructor(userId: string, files = new Map<string, { body: string; version: string; uploadedAt: Date }>()) {
		userRoot(userId);
		this.userId = userId;
		this.#files = files;
	}

	async readJson<T>(path: string): Promise<StoredJson<T> | null> {
		const file = this.#files.get(resolvePath(this.userId, path));
		return file ? { data: JSON.parse(file.body) as T, version: file.version } : null;
	}

	async writeJson(path: string, data: unknown, options: WriteOptions = {}): Promise<{ version: string }> {
		const key = resolvePath(this.userId, path);
		const existing = this.#files.get(key);
		if (options.createOnly && existing) throw new StorageConflictError(path);
		if (options.ifMatch !== undefined && existing?.version !== options.ifMatch) {
			throw new StorageConflictError(path);
		}
		const version = `v${++this.#counter}`;
		this.#files.set(key, { body: JSON.stringify(data), version, uploadedAt: new Date() });
		return { version };
	}

	async list(prefix = ''): Promise<StoredFileInfo[]> {
		const root = userRoot(this.userId);
		const full = resolvePath(this.userId, prefix, { file: false });
		return [...this.#files.entries()]
			.filter(([key]) => key.startsWith(full))
			.map(([key, f]) => ({
				path: key.slice(root.length),
				size: f.body.length,
				uploadedAt: f.uploadedAt,
				version: f.version
			}));
	}

	async delete(path: string): Promise<void> {
		this.#files.delete(resolvePath(this.userId, path));
	}

	/** En kopia att torrköra mot: skrivningar påverkar inte originalet. */
	clone(): MemoryUserStorage {
		return new MemoryUserStorage(this.userId, new Map(this.#files));
	}
}
