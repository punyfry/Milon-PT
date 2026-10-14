import { encode } from '@auth/core/jwt';
import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { E2E_AUTH_SECRET, E2E_EMAIL } from './env';

const COOKIE = 'authjs.session-token';

export interface TestUser {
	id: string;
	/** Writes JSON files into the user's storage, keyed by path (e.g. `profile.json`). */
	seed(files: Record<string, unknown>): Promise<void>;
	/** All of the user's files, keyed by path. */
	files(): Promise<Record<string, unknown>>;
}

/**
 * Every test gets a user of its own (a new id, so empty storage) that is
 * signed in through a minted Auth.js session cookie. Tests don't share data
 * and can run in parallel.
 */
export const test = base.extend<{ user: TestUser }>({
	user: async ({ context, request, baseURL }, use) => {
		const id = `e2e_${randomUUID().replaceAll('-', '')}`;
		const token = await encode({
			token: { sub: id, userId: id, email: E2E_EMAIL, name: 'Testa Testsson', signedInAt: Math.floor(Date.now() / 1000) },
			secret: E2E_AUTH_SECRET,
			salt: COOKIE
		});
		await context.addCookies([{ name: COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
		const endpoint = `/__e2e/files?user=${id}`;
		await use({
			id,
			async seed(files) {
				const res = await request.post(endpoint, { data: files });
				expect(res.ok(), await res.text()).toBe(true);
			},
			async files() {
				const res = await request.get(endpoint);
				expect(res.ok(), await res.text()).toBe(true);
				return (await res.json()) as Record<string, unknown>;
			}
		});
	}
});

export { expect };

/**
 * Opens a page and waits until it is hydrated: on the dev server a click before
 * that hits a server-rendered button without its handler and does nothing.
 */
export async function open(page: Page, path: string): Promise<void> {
	await page.goto(path, { waitUntil: 'networkidle' });
}
