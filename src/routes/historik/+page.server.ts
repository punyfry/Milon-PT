import { error } from '@sveltejs/kit';
import { addDays, isValidDate, metricFor, milestoneExercises, progressSeries, weekStartOf, weekSummary } from '$lib/history/stats';
import { getProfile, listExercises, listLatestWorkouts, listSessionsBetween } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { PageServerLoad } from './$types';

/** `/historik?vecka=YYYY-MM-DD` shows the week containing the date (default: this week). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const storage = storageFor(locals);
	const today = todayInStockholm();
	const param = url.searchParams.get('vecka');
	if (param !== null && !isValidDate(param)) error(400, 'Ogiltigt datum');
	const start = weekStartOf(param ?? today);
	const currentStart = weekStartOf(today);

	const [stored, sessions, profile, workouts] = await Promise.all([
		listExercises(storage),
		listSessionsBetween(storage, start, addDays(start, 7)),
		getProfile(storage),
		listLatestWorkouts(storage)
	]);
	const exercises = stored.map((e) => e.data);

	// Exercises with history, most recently trained first. Summary only, never the whole log.
	const list = exercises
		.filter((e) => e.log.length)
		.map((e) => {
			const lastDate = e.log.reduce((d, l) => (l.date > d ? l.date : d), '');
			const series = progressSeries(e);
			const best = series.reduce((b, p) => Math.max(b, p.value), 0);
			return { id: e.id, name: e.name, type: e.type, archived: e.archived, lastDate, best, metric: metricFor(e.type).label };
		})
		.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name, 'sv'));

	// Exercises grouped by workout (in the workout's order). An exercise in several workouts shows in the
	// first one; exercises not in any workout go under "Övrigt".
	const byId = new Map(list.filter((e) => !e.archived).map((e) => [e.id, e]));
	const groups: { name: string; exercises: typeof list }[] = [];
	for (const w of [...workouts].sort((a, b) => a.name.localeCompare(b.name, 'sv'))) {
		const items = w.exercises.map((we) => byId.get(we.exerciseId)).filter((e) => e !== undefined);
		for (const e of items) byId.delete(e.id);
		if (items.length) groups.push({ name: w.name, exercises: items });
	}
	if (byId.size) groups.push({ name: 'Övrigt', exercises: [...byId.values()] });

	const milestones = milestoneExercises(exercises).map((m) => ({
		key: m.key,
		title: m.title,
		exercise: m.exercise ? { id: m.exercise.id, name: m.exercise.name, type: m.exercise.type } : null,
		progress: m.progress,
		others: m.others.map((e) => ({ id: e.id, name: e.name })),
		points: m.exercise ? progressSeries(m.exercise).map((p) => ({ date: p.date, value: p.value })) : []
	}));

	return {
		today,
		week: weekSummary(start, exercises, sessions),
		weeklyGoal: profile.data.weeklySessionGoal ?? null,
		prevWeek: isValidDate(addDays(start, -7)) ? addDays(start, -7) : null,
		nextWeek: start < currentStart ? addDays(start, 7) : null,
		isCurrentWeek: start === currentStart,
		groups,
		archived: list.filter((e) => e.archived),
		milestones
	};
};
