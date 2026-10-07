import { addDays, isoWeek, weekStartOf } from '$lib/history/stats';
import { getProfile, lastSessionBySlug, listExercises, listLatestWorkouts, listSessionsBetween } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { PageServerLoad } from './$types';

export interface WorkoutCard {
	slug: string;
	name: string;
	version: number;
	/** Exercise names in the workout's order. */
	exerciseNames: string[];
	/** Start time of the latest session with this template (any version). */
	lastTrainedAt: string | null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const storage = storageFor(locals);
	const today = todayInStockholm();
	const weekStart = weekStartOf(today);
	const [workouts, exercises, weekSessions, profile] = await Promise.all([
		listLatestWorkouts(storage),
		listExercises(storage),
		listSessionsBetween(storage, weekStart, addDays(weekStart, 7)),
		getProfile(storage)
	]);
	const lastBySlug = await lastSessionBySlug(storage, workouts.map((w) => w.slug));
	const names = new Map(exercises.map((e) => [e.data.id, e.data.name]));

	const cards: WorkoutCard[] = workouts.map((w) => ({
		slug: w.slug,
		name: w.name,
		version: w.version,
		exerciseNames: w.exercises.map((e) => names.get(e.exerciseId) ?? e.exerciseId),
		lastTrainedAt: lastBySlug.get(w.slug) ?? null
	}));
	// Most recently trained first, then other trained ones, then never trained in name order.
	cards.sort((a, b) => {
		if (a.lastTrainedAt && b.lastTrainedAt) return Date.parse(b.lastTrainedAt) - Date.parse(a.lastTrainedAt);
		if (a.lastTrainedAt || b.lastTrainedAt) return a.lastTrainedAt ? -1 : 1;
		return a.name.localeCompare(b.name, 'sv');
	});

	return {
		cards,
		today,
		week: { number: isoWeek(weekStart), sessions: weekSessions.length, goal: profile.data.weeklySessionGoal ?? null }
	};
};
