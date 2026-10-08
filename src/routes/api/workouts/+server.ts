import { error, json } from '@sveltejs/kit';
import { ValidationError } from '$lib/model';
import { WorkoutChangedError, parseManualWorkoutInput, saveManualWorkout } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { RequestHandler } from './$types';

/** Saves a workout built by hand: { editSlug, name, items } → { slug, version, saved }. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const storage = storageFor(locals);
	const body = await request.json().catch(() => error(400, 'Ogiltig JSON'));
	try {
		return json(await saveManualWorkout(storage, parseManualWorkoutInput(body), todayInStockholm()));
	} catch (e) {
		if (e instanceof ValidationError) error(400, e.issues.join(' '));
		if (e instanceof WorkoutChangedError) error(409, e.message);
		if (e instanceof StorageConflictError) error(409, 'Något ändrades samtidigt. Försök igen.');
		throw e;
	}
};
