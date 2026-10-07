import { error, json } from '@sveltejs/kit';
import { ValidationError } from '$lib/model';
import { parseSaveSessionInput, saveSession } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** Saves a finished session. The client clears localStorage only after this responds OK. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const storage = storageFor(locals);
	const body = await request.json().catch(() => error(400, 'Ogiltig JSON'));
	try {
		const result = await saveSession(storage, parseSaveSessionInput(body));
		return json(result);
	} catch (e) {
		if (e instanceof ValidationError) error(400, e.issues.join('; '));
		if (e instanceof StorageConflictError) error(409, 'Något ändrades samtidigt. Försök igen.');
		throw e;
	}
};
