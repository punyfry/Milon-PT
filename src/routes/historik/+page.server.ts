import { error } from '@sveltejs/kit';
import { addDays, metricFor, milestoneExercises, progressSeries, weekStartOf, weekSummary } from '$lib/history/stats';
import { getProfile, listExercises, listSessions } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { PageServerLoad } from './$types';

/** `/historik?vecka=YYYY-MM-DD` visar veckan som innehåller datumet (standard: denna vecka). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const storage = storageFor(locals);
	const today = todayInStockholm();
	const param = url.searchParams.get('vecka');
	if (param !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(param) || Number.isNaN(Date.parse(param)))) error(400, 'Ogiltigt datum');
	const start = weekStartOf(param ?? today);
	const currentStart = weekStartOf(today);

	const [stored, sessions, profile] = await Promise.all([listExercises(storage), listSessions(storage), getProfile(storage)]);
	const exercises = stored.map((e) => e.data);

	// Övningar med historik, senast tränade först. Bara sammanfattning, aldrig hela loggen.
	const list = exercises
		.filter((e) => e.log.length)
		.map((e) => {
			const lastDate = e.log.reduce((d, l) => (l.date > d ? l.date : d), '');
			const series = progressSeries(e);
			const best = series.reduce((b, p) => Math.max(b, p.value), 0);
			return { id: e.id, name: e.name, type: e.type, lastDate, best, metric: metricFor(e.type).label };
		})
		.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name, 'sv'));

	const milestones = milestoneExercises(exercises).map((m) => ({
		key: m.key,
		title: m.title,
		exercise: m.exercise ? { id: m.exercise.id, name: m.exercise.name, type: m.exercise.type } : null,
		points: m.exercise ? progressSeries(m.exercise).map((p) => ({ date: p.date, value: p.value })) : []
	}));


	return {
		today,
		week: weekSummary(start, exercises, sessions),
		weeklyGoal: profile.data.weeklySessionGoal ?? null,
		prevWeek: addDays(start, -7),
		nextWeek: start < currentStart ? addDays(start, 7) : null,
		isCurrentWeek: start === currentStart,
		exercises: list,
		milestones
	};
};
