import type { StoredFileInfo, StoredJson, UserStorage, WriteOptions } from './types';

export interface StorageStats {
	reads: number;
	lists: number;
	writes: number;
	/** Reads and listings answered from an earlier call in the same request. */
	shared: number;
	/** Wall-clock time with at least one storage call in flight. */
	ms: number;
}

/**
 * Wraps the storage for one request. It measures the calls (for the
 * Server-Timing header) and, when `shareReads` is set (GET requests), lets
 * identical reads and listings within the request share one call: the start
 * page and the history page otherwise list and read the same files several
 * times. Every write or delete drops what is shared, also when it fails, so a
 * retry after a conflict reads the file again.
 */
export class RequestStorage implements UserStorage {
	readonly stats: StorageStats = { reads: 0, lists: 0, writes: 0, shared: 0, ms: 0 };
	readonly #inner: UserStorage;
	readonly #shareReads: boolean;
	readonly #reads = new Map<string, Promise<StoredJson<unknown> | null>>();
	readonly #lists = new Map<string, Promise<StoredFileInfo[]>>();
	#inFlight = 0;
	#busySince = 0;

	constructor(inner: UserStorage, options: { shareReads: boolean }) {
		this.#inner = inner;
		this.#shareReads = options.shareReads;
	}

	get userId(): string {
		return this.#inner.userId;
	}

	async readJson<T>(path: string): Promise<StoredJson<T> | null> {
		let read = this.#shareReads ? this.#reads.get(path) : undefined;
		if (read) this.stats.shared++;
		else {
			this.stats.reads++;
			read = this.#timed(() => this.#inner.readJson<unknown>(path));
			if (this.#shareReads) this.#share(this.#reads, path, read);
		}
		const file = await read;
		// Each caller gets its own copy, since callers may modify the data.
		return file && { data: structuredClone(file.data) as T, version: file.version };
	}

	async list(prefix = ''): Promise<StoredFileInfo[]> {
		let listing = this.#shareReads ? this.#lists.get(prefix) : undefined;
		if (listing) this.stats.shared++;
		else {
			this.stats.lists++;
			listing = this.#timed(() => this.#inner.list(prefix));
			if (this.#shareReads) this.#share(this.#lists, prefix, listing);
		}
		return (await listing).map((f) => ({ ...f }));
	}

	async writeJson(path: string, data: unknown, options?: WriteOptions): Promise<{ version: string }> {
		this.stats.writes++;
		try {
			return await this.#timed(() => this.#inner.writeJson(path, data, options));
		} finally {
			this.#forget(path);
		}
	}

	async delete(path: string): Promise<void> {
		this.stats.writes++;
		try {
			await this.#timed(() => this.#inner.delete(path));
		} finally {
			this.#forget(path);
		}
	}

	/** Shares a pending call; a failed call is not shared, so the next caller tries again. */
	#share<V>(map: Map<string, Promise<V>>, key: string, call: Promise<V>): void {
		map.set(key, call);
		call.catch(() => {
			if (map.get(key) === call) map.delete(key);
		});
	}

	#forget(path: string): void {
		this.#reads.delete(path);
		this.#lists.clear();
	}

	async #timed<V>(call: () => Promise<V>): Promise<V> {
		if (this.#inFlight++ === 0) this.#busySince = performance.now();
		try {
			return await call();
		} finally {
			if (--this.#inFlight === 0) this.stats.ms += performance.now() - this.#busySince;
		}
	}
}
