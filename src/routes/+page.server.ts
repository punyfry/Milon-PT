import { addDays, isoWeek, weekStartOf, weekSummary } from '$lib/history/stats';
import { getProfile, lastSessionBySlug, listExercises, listLatestWorkouts, listSessionsBetween } from '$lib/server/data';
import { aiAvailable } from '$lib/server/ai/client';
import { storageFor } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import { redirect } from '@sveltejs/kit';
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
	const latest = listLatestWorkouts(storage);
	// Everything in parallel; the latest session per workout only waits for the workout list.
	const [workouts, lastBySlug, exercises, weekSessions, profile] = await Promise.all([
		latest,
		latest.then((ws) => lastSessionBySlug(storage, ws.map((w) => w.slug))),
		listExercises(storage),
		listSessionsBetween(storage, weekStart, addDays(weekStart, 7)),
		getProfile(storage)
	]);
	// A new user (no intro done, nothing saved yet) starts with the intro. Those who already
	// had workouts or exercises before the intro existed never see it unasked.
	if (!profile.data.onboardedAt && !workouts.length && !exercises.length) redirect(303, '/valkommen');
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
		coach: aiAvailable(profile.data),
		today,
		week: {
			number: isoWeek(weekStart),
			// Counted like the history page: sessions plus days with only imported log entries.
			sessions: weekSummary(weekStart, exercises.map((e) => e.data), weekSessions).sessionCount,
			goal: profile.data.weeklySessionGoal ?? null
		}
	};
};
