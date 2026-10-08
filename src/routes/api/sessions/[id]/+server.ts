import { error, json } from '@sveltejs/kit';
import { ValidationError, isObject } from '$lib/model';
import { deleteSession, editSession, parseEditSessionInput } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const CONFLICT = 'Passet ändrades någon annanstans. Ladda om sidan och försök igen.';

/** Corrects a saved session: times, sets, kcal, or removing an exercise from it. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const storage = storageFor(locals);
	const body = await request.json().catch(() => error(400, 'Ogiltig JSON'));
	try {
		const session = await editSession(storage, params.id, parseEditSessionInput(body));
		if (!session) error(404, 'Passet finns inte');
		return json({ session });
	} catch (e) {
		if (e instanceof ValidationError) error(400, e.issues.join(' '));
		if (e instanceof StorageConflictError) error(409, CONFLICT);
		throw e;
	}
};

/** Deletes a saved session and its sets: { version }. */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	const storage = storageFor(locals);
	const body: unknown = await request.json().catch(() => null);
	if (!isObject(body) || typeof body.version !== 'string' || !body.version) error(400, 'version saknas');
	try {
		if (!(await deleteSession(storage, params.id, body.version))) error(404, 'Passet finns inte');
		return json({ deleted: true });
	} catch (e) {
		if (e instanceof StorageConflictError) error(409, CONFLICT);
		throw e;
	}
};
