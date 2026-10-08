import { error } from '@sveltejs/kit';
import { getLatestWorkout, getProfile, getWorkout, listExercises } from '$lib/server/data';
import { isAiConfigured } from '$lib/server/ai/client';
import { toInfo } from '$lib/server/helper/swap';
import { storageFor } from '$lib/server/storage';
import { kcalSuggestion, type ExerciseInfo } from '$lib/session/active';
import type { PageServerLoad } from './$types';

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Data for the overview and the active session: the workout template (`?v=`
 * for a specific version, otherwise the latest) and the exercises with only
 * their latest log entry. Exercises swapped in during the session are passed
 * as `?ex=id1,id2`. `catalog` holds every exercise that is not archived, to
 * swap to; it comes with the page so swapping works offline in the gym.
 * `exercises` only adds the workout's (and `?ex=`) exercises that are not in
 * the catalog, i.e. archived ones.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const storage = storageFor(locals);
	const v = url.searchParams.get('v');
	const version = v === null ? null : Number(v);
	if (version !== null && (!Number.isInteger(version) || version < 1)) error(400, 'Ogiltig version');

	const workout =
		version === null
			? await getLatestWorkout(storage, params.slug)
			: ((await getWorkout(storage, params.slug, version))?.data ?? null);
	if (!workout) error(404, 'Passet finns inte');

	const extra = (url.searchParams.get('ex') ?? '').split(',').filter((id) => ID.test(id));
	const ids = [...new Set([...workout.exercises.map((e) => e.exerciseId), ...extra])];
	const [stored, { data: profile }] = await Promise.all([listExercises(storage), getProfile(storage)]);
	const byId = new Map(stored.map((e) => [e.data.id, e.data]));
	const archived = ids.map((id) => byId.get(id)).filter((e) => e?.archived);
	const exercises: ExerciseInfo[] = archived.map((e) => toInfo(e!));
	const catalog: ExerciseInfo[] = stored
		.filter((e) => !e.data.archived)
		.map((e) => toInfo(e.data))
		.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
	return {
		workout,
		exercises,
		catalog,
		kcalSuggestion: kcalSuggestion(profile, workout),
		helperAvailable: isAiConfigured()
	};
};
