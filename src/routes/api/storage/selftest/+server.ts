import { json } from '@sveltejs/kit';
import { storageFor } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * Writes and reads back a small file in the user's folder to verify the Blob
 * setup end to end. Never returns a blob URL.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const storage = storageFor(locals);
	const writtenAt = new Date().toISOString();
	await storage.writeJson('_selftest.json', { writtenAt });
	const read = await storage.readJson<{ writtenAt: string }>('_selftest.json');
	return json({ ok: read?.data.writtenAt === writtenAt, writtenAt });
};
