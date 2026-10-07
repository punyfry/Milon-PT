import { lastSessionBySlug, listLatestWorkouts } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

export interface WorkoutCard {
	slug: string;
	name: string;
	version: number;
	exerciseCount: number;
	/** Start time of the latest session with this template (all versions). */
	lastTrainedAt: string | null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const storage = storageFor(locals);
	const workouts = await listLatestWorkouts(storage);
	const lastBySlug = await lastSessionBySlug(storage, workouts.map((w) => w.slug));

	const cards: WorkoutCard[] = workouts.map((w) => ({
		slug: w.slug,
		name: w.name,
		version: w.version,
		exerciseCount: w.exercises.length,
		lastTrainedAt: lastBySlug.get(w.slug) ?? null
	}));
	// Most recently trained first, then other trained ones, finally never trained in name order.
	cards.sort((a, b) => {
		if (a.lastTrainedAt && b.lastTrainedAt) return Date.parse(b.lastTrainedAt) - Date.parse(a.lastTrainedAt);
		if (a.lastTrainedAt || b.lastTrainedAt) return a.lastTrainedAt ? -1 : 1;
		return a.name.localeCompare(b.name, 'sv');
	});

	return { cards };
};
