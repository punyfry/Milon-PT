import { listLatestWorkouts, listSessions } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

export interface WorkoutCard {
	slug: string;
	name: string;
	version: number;
	exerciseCount: number;
	/** Starttid för senaste passet med den här mallen (alla versioner). */
	lastTrainedAt: string | null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const storage = storageFor(locals);
	const [workouts, sessions] = await Promise.all([listLatestWorkouts(storage), listSessions(storage)]);

	const lastBySlug = new Map<string, string>();
	for (const s of sessions) {
		const prev = lastBySlug.get(s.workoutSlug);
		if (!prev || Date.parse(s.startedAt) > Date.parse(prev)) lastBySlug.set(s.workoutSlug, s.startedAt);
	}

	const cards: WorkoutCard[] = workouts.map((w) => ({
		slug: w.slug,
		name: w.name,
		version: w.version,
		exerciseCount: w.exercises.length,
		lastTrainedAt: lastBySlug.get(w.slug) ?? null
	}));
	// Senast tränade passet först, sedan övriga tränade, sist aldrig tränade i namnordning.
	cards.sort((a, b) => {
		if (a.lastTrainedAt && b.lastTrainedAt) return Date.parse(b.lastTrainedAt) - Date.parse(a.lastTrainedAt);
		if (a.lastTrainedAt || b.lastTrainedAt) return a.lastTrainedAt ? -1 : 1;
		return a.name.localeCompare(b.name, 'sv');
	});

	return { cards };
};
