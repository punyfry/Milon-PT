/** Route tests for the account page: deleting the account and who sees the Craft import. */
import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../test/env-private';
import { createExercise, saveProfile } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));

const konto = await import('./konto/+page.server');
const start = await import('./+page.server');
const { POST: importer } = await import('./api/import/+server');

const locals = { user: { id: 'u1', email: 'a@b.c', name: null } };
const event = (extra: Record<string, unknown> = {}) =>
	({ locals, url: new URL('https://milon.test/konto'), params: {}, ...extra }) as never;

beforeEach(async () => {
	state.storage = new MemoryUserStorage('u1');
	await saveProfile(state.storage, { coach: true, onboardedAt: '2026-10-01' });
	await createExercise(state.storage, { name: 'Marklyft', type: 'weight', instruction: '' });
});

afterEach(() => {
	delete env.IMPORT_EMAILS;
});

describe('deleting the account', () => {
	it('deletes all files', async () => {
		expect(await konto.actions.deleteAccount(event())).toEqual({ accountDeleted: true });
		expect(await state.storage.list()).toEqual([]);
	});

	it('answers 500 with a message when the storage fails', async () => {
		vi.spyOn(state.storage, 'delete').mockRejectedValueOnce(new Error('Blob is down'));
		vi.spyOn(console, 'error').mockImplementationOnce(() => {});
		const result = (await konto.actions.deleteAccount(event())) as { status: number; data: { deleteError: string } };
		expect(result.status).toBe(500);
		expect(result.data.deleteError).toContain('kunde inte raderas');
	});
});

describe('the Craft import', () => {
	async function importStatus() {
		const request = new Request('https://milon.test/api/import', { method: 'POST', body: JSON.stringify({ data: { exercises: [] } }) });
		try {
			return (await importer({ locals, request } as never)).status;
		} catch (e) {
			if (isHttpError(e)) return e.status;
			throw e;
		}
	}

	it('is hidden and refused when IMPORT_EMAILS is empty', async () => {
		expect((await konto.load(event())) as { canImport: boolean }).toMatchObject({ canImport: false });
		expect((await start.load(event())) as { canImport: boolean }).toMatchObject({ canImport: false });
		expect(await importStatus()).toBe(403);
	});

	it('is shown and allowed for the addresses in IMPORT_EMAILS', async () => {
		env.IMPORT_EMAILS = 'annan@example.com, A@B.C';
		expect((await konto.load(event())) as { canImport: boolean }).toMatchObject({ canImport: true });
		expect((await start.load(event())) as { canImport: boolean }).toMatchObject({ canImport: true });
		expect(await importStatus()).toBe(200);
	});
});
