import { error, fail, redirect } from '@sveltejs/kit';
import { ValidationError } from '$lib/model';
import { addDays, groupByWorkout, isValidDate, metricFor, milestoneExercises, progressSeries, weekStartOf, weekSummary } from '$lib/history/stats';
import { createExerciseFromInput, getProfile, listExercises, listLatestWorkouts, listSessionsBetween } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

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
	// Deleted exercises still count in the week, but are not listed (#46).
	const active = exercises.filter((e) => !e.deleted);

	// Every exercise, most recently trained first and untrained ones last (#64). Summary only, never the whole log.
	const list = active
		.map((e) => {
			const lastDate = e.log.reduce((d, l) => (l.date > d ? l.date : d), '');
			const series = progressSeries(e);
			const best = series.reduce((b, p) => Math.max(b, p.value), 0);
			return { id: e.id, name: e.name, type: e.type, lastDate, best, metric: metricFor(e.type).label };
		})
		.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name, 'sv'));

	const groups = groupByWorkout(list, workouts);

	const milestones = milestoneExercises(active).map((m) => ({
		key: m.key,
		title: m.title,
		exercise: m.exercise ? { id: m.exercise.id, name: m.exercise.name, type: m.exercise.type } : null,
		progress: m.progress,
		others: m.others.map((e) => ({ id: e.id, name: e.name })),
		points: m.exercise ? progressSeries(m.exercise).map((p) => ({ date: p.date, value: p.value })) : []
	}));

	const names = new Map(workouts.map((w) => [w.slug, w.name]));
	return {
		today,
		week: weekSummary(start, exercises, sessions),
		/** The week's saved sessions, oldest first; each opens /historik/pass/[id]. */
		sessions: sessions
			.map((s) => ({ id: s.id, name: names.get(s.workoutSlug) ?? s.workoutSlug, startedAt: s.startedAt, endedAt: s.endedAt }))
			.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
		weeklyGoal: profile.data.weeklySessionGoal ?? null,
		prevWeek: isValidDate(addDays(start, -7)) ? addDays(start, -7) : null,
		nextWeek: start < currentStart ? addDays(start, 7) : null,
		isCurrentWeek: start === currentStart,
		groups,
		milestones
	};
};

export const actions: Actions = {
	/** Adds an exercise on its own, outside a workout (#64), and opens it. */
	create: async ({ locals, request }) => {
		const form = await request.formData();
		const input = { name: form.get('name'), type: form.get('type'), instruction: form.get('instruction') ?? '', note: form.get('note') ?? '' };
		let id: string;
		try {
			id = (await createExerciseFromInput(storageFor(locals), input)).data.id;
		} catch (e) {
			if (e instanceof ValidationError) return fail(400, { createError: e.issues.join(' ') });
			throw e;
		}
		redirect(303, `/historik/ovning/${id}`);
	}
};
