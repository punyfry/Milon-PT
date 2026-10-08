import { error, json } from '@sveltejs/kit';
import { isObject } from '$lib/model';
import { WorkoutRestoreError, restoreWorkoutVersion } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { RequestHandler } from './$types';

/** Restores an older version by saving it as the next version. Nothing is overwritten. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const storage = storageFor(locals);
	const body: unknown = await request.json().catch(() => null);
	const version = isObject(body) ? body.version : undefined;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) error(400, 'Ogiltig version');

	try {
		const saved = await restoreWorkoutVersion(storage, params.slug, version, todayInStockholm());
		if (!saved) error(404, 'Versionen finns inte');
		return json({ version: saved.version });
	} catch (e) {
		if (e instanceof WorkoutRestoreError) error(409, e.message);
		throw e;
	}
};
