import { MemoryUserStorage } from './memory';

type Files = ConstructorParameters<typeof MemoryUserStorage>[1];

const KEY = Symbol.for('milon-pt.e2e-files');

/**
 * The file map behind the UI tests' in-memory storage. It lives on `globalThis`
 * so the dev server's request handlers and the test seeding middleware
 * (`e2e/vite-plugin.ts`, loaded as a separate module copy) share it.
 */
export function e2eFiles(): NonNullable<Files> {
	const global = globalThis as { [KEY]?: NonNullable<Files> };
	return (global[KEY] ??= new Map());
}

/** Storage for one user in the UI tests' in-memory store. */
export function e2eStorage(userId: string): MemoryUserStorage {
	return new MemoryUserStorage(userId, e2eFiles());
}
