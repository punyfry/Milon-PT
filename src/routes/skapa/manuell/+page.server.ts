import { error } from '@sveltejs/kit';
import type { ExerciseType, Target } from '$lib/model';
import { aiAvailable } from '$lib/server/ai/client';
import { getProfile, getWorkoutHistory, listExercises, listLatestWorkouts, type VersionSummary } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

export interface CatalogExercise {
	id: string;
	name: string;
	type: ExerciseType;
	deleted: boolean;
}

/** Building a workout by hand: `/skapa/manuell` for a new one, `?pass=<slug>` to edit one. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const storage = storageFor(locals);
	const slug = url.searchParams.get('pass');
	const [exercises, workouts, profile, history] = await Promise.all([
		listExercises(storage),
		listLatestWorkouts(storage),
		getProfile(storage),
		slug ? getWorkoutHistory(storage, slug) : null
	]);
	if (slug && !history) error(404, 'Passet finns inte');

	const catalog: CatalogExercise[] = exercises
		.map(({ data: e }) => ({ id: e.id, name: e.name, type: e.type, deleted: e.deleted === true }))
		.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
	let editing: { slug: string; name: string; version: number; items: { exerciseId: string; sets: number; target: Target }[] } | null = null;
	let versions: VersionSummary[] = [];
	if (history) {
		const { latest } = history;
		editing = { slug: latest.slug, name: latest.name, version: latest.version, items: latest.exercises };
		versions = history.versions;
	}

	return {
		catalog,
		editing,
		versions,
		workouts: workouts.map((w) => ({ slug: w.slug, name: w.name })).sort((a, b) => a.name.localeCompare(b.name, 'sv')),
		coach: aiAvailable(profile.data)
	};
};
