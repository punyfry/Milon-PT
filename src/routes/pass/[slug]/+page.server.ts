import { error } from '@sveltejs/kit';
import { getExercise, getLatestWorkout, getProfile, getWorkout } from '$lib/server/data';
import { isAiConfigured } from '$lib/server/ai/client';
import { toInfo } from '$lib/server/helper/swap';
import { storageFor } from '$lib/server/storage';
import { kcalSuggestion, type ExerciseInfo } from '$lib/session/active';
import type { PageServerLoad } from './$types';

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Data for the active session: the workout template (`?v=` for a specific
 * version, otherwise the latest) and the exercises with only their latest log
 * entry. Exercises swapped in during the session are passed as `?ex=id1,id2`.
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
	const exercises: ExerciseInfo[] = [];
	for (const id of ids) {
		const stored = await getExercise(storage, id);
		if (!stored) continue;
		exercises.push(toInfo(stored.data));
	}

	const profile = (await getProfile(storage)).data;
	return {
		workout,
		exercises,
		kcalSuggestion: kcalSuggestion(profile, workout),
		helperAvailable: isAiConfigured()
	};
};
