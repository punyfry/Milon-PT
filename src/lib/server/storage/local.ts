import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { resolvePath, userRoot } from './paths';
import {
	StorageConflictError,
	type StoredFileInfo,
	type StoredJson,
	type UserStorage,
	type WriteOptions
} from './types';

/**
 * Lagring i lokala filer under `.data/`. Används bara i dev när
 * `BLOB_READ_WRITE_TOKEN` saknas, så appen går att köra lokalt utan Blob.
 * Samma semantik som Blob-implementationen.
 */
export class LocalFileUserStorage implements UserStorage {
	readonly userId: string;
	readonly #base: string;

	constructor(userId: string, baseDir = '.data') {
		userRoot(userId);
		this.userId = userId;
		this.#base = baseDir;
	}

	#file(pathname: string): string {
		return join(this.#base, pathname);
	}

	static #version(body: string): string {
		return createHash('sha1').update(body).digest('hex');
	}

	async readJson<T>(path: string): Promise<StoredJson<T> | null> {
		try {
			const body = await readFile(this.#file(resolvePath(this.userId, path)), 'utf8');
			return { data: JSON.parse(body) as T, version: LocalFileUserStorage.#version(body) };
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw e;
		}
	}

	async writeJson(path: string, data: unknown, options: WriteOptions = {}): Promise<{ version: string }> {
		const file = this.#file(resolvePath(this.userId, path));
		const existing = await readFile(file, 'utf8').catch(() => null);
		if (options.createOnly && existing !== null) throw new StorageConflictError(path);
		if (options.ifMatch !== undefined && (existing === null || LocalFileUserStorage.#version(existing) !== options.ifMatch)) {
			throw new StorageConflictError(path);
		}
		const body = JSON.stringify(data, null, 2);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, body);
		return { version: LocalFileUserStorage.#version(body) };
	}

	async list(prefix = ''): Promise<StoredFileInfo[]> {
		const root = this.#file(userRoot(this.userId));
		const dir = this.#file(resolvePath(this.userId, prefix, { file: false }));
		const out: StoredFileInfo[] = [];
		const walk = async (d: string) => {
			const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
			for (const entry of entries) {
				const full = join(d, entry.name);
				if (entry.isDirectory()) await walk(full);
				else {
					const [info, body] = await Promise.all([stat(full), readFile(full, 'utf8')]);
					out.push({
						path: relative(root, full).split('\\').join('/'),
						size: info.size,
						uploadedAt: info.mtime,
						version: LocalFileUserStorage.#version(body)
					});
				}
			}
		};
		await walk(dir);
		return out;
	}

	async delete(path: string): Promise<void> {
		await rm(this.#file(resolvePath(this.userId, path)), { force: true });
	}
}
