import { error, json } from '@sveltejs/kit';
import { isObject } from '$lib/model';
import { getWorkout, saveWorkoutVersion } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { RequestHandler } from './$types';

/** Återställer en äldre version genom att spara den som nästa version. Inget skrivs över. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const storage = storageFor(locals);
	const body: unknown = await request.json().catch(() => null);
	const version = isObject(body) ? body.version : undefined;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) error(400, 'Ogiltig version');

	const old = await getWorkout(storage, params.slug, version);
	if (!old) error(404, 'Versionen finns inte');
	const saved = await saveWorkoutVersion(storage, {
		slug: old.data.slug,
		name: old.data.name,
		createdAt: todayInStockholm(),
		changeNote: `Återställd från version ${version}`,
		exercises: old.data.exercises
	});
	return json({ version: saved.version });
};
