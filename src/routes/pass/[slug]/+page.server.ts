import { error } from '@sveltejs/kit';
import { getExercise, getLatestWorkout, getProfile, getWorkout } from '$lib/server/data';
import { bestEver } from '$lib/history/stats';
import { isAiConfigured } from '$lib/server/ai/client';
import { storageFor } from '$lib/server/storage';
import { DEFAULT_KCAL, type ExerciseInfo } from '$lib/session/active';
import type { PageServerLoad } from './$types';

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Data för det aktiva passet: passmallen (`?v=` för en viss version, annars
 * senaste) och övningarna med bara senaste loggposten. Övningar som bytts in
 * under passet skickas med som `?ex=id1,id2`.
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
		const { name, type, loadClass, instruction, log } = stored.data;
		const best = bestEver(stored.data);
		exercises.push({
			id,
			name,
			type,
			...(loadClass ? { loadClass } : {}),
			instruction,
			...(log[0] ? { lastEntry: log[0] } : {}),
			...(best !== null ? { best } : {})
		});
	}

	const profile = (await getProfile(storage)).data;
	return {
		workout,
		exercises,
		kcalSuggestion: profile.kcalPerWorkout?.[workout.slug] ?? DEFAULT_KCAL,
		helperAvailable: isAiConfigured()
	};
};
