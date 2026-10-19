import { error, fail, redirect } from '@sveltejs/kit';
import { SAFE_ID, ValidationError } from '$lib/model';
import { bestSet, metricFor, progressSeries, recordEntries } from '$lib/history/stats';
import { volume } from '$lib/session/active';
import { deleteExercise, deleteLockReason, getExercise, typeLockReason, updateExerciseDetails, workoutsUsing } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { Actions, PageServerLoad } from './$types';

/** Chart of the best set per session and a table of the latest sessions for one exercise. */
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!SAFE_ID.test(params.id)) error(404, 'Övningen finns inte');
	const storage = storageFor(locals);
	const stored = await getExercise(storage, params.id);
	if (!stored) error(404, 'Övningen finns inte');
	const ex = stored.data;
	const records = recordEntries(ex);
	// Read once; the locks are worked out from the same list.
	const workouts = await workoutsUsing(storage, ex.id);

	return {
		exercise: {
			id: ex.id,
			name: ex.name,
			type: ex.type,
			instruction: ex.instruction,
			note: ex.note ?? '',
			// A deleted exercise is still shown (an old session links here), but can't be changed.
			deleted: ex.deleted === true,
			typeLock: await typeLockReason(storage, ex, workouts),
			deleteLock: await deleteLockReason(storage, ex, workouts),
			/** The workouts whose latest version uses the exercise (#71). */
			workouts: ex.deleted ? [] : workouts
		},
		metric: metricFor(ex.type),
		points: progressSeries(ex).map((p) => ({ date: p.date, value: p.value })),
		entries: ex.log.slice(0, 15).map((e, i) => ({
			sessionId: e.sessionId ?? null,
			date: e.date,
			sets: e.sets,
			note: e.note ?? null,
			// Warm-up and stretch are shown as done, but have no best set or volume (#100).
			phase: e.phase ?? null,
			best: e.phase ? null : (bestSet(ex.type, e.sets)?.value ?? null),
			volume: e.phase ? null : volume(ex.type, e.sets),
			record: records.get(i) ?? []
		}))
	};
};

export const actions: Actions = {
	/** Changes name, type and instruction. */
	edit: async ({ locals, params, request }) => {
		if (!SAFE_ID.test(params.id)) error(404, 'Övningen finns inte');
		const form = await request.formData();
		const input = { name: form.get('name'), type: form.get('type'), instruction: form.get('instruction') ?? '', note: form.get('note') ?? '' };
		try {
			await updateExerciseDetails(storageFor(locals), params.id, input);
		} catch (e) {
			if (e instanceof ValidationError) return fail(400, { editError: e.issues.join(' ') });
			if (e instanceof StorageConflictError) return fail(409, { editError: 'Övningen ändrades samtidigt. Försök igen.' });
			throw e;
		}
		return { edited: true };
	},

	/** Deletes the exercise from the catalog; its log stays in history (#46). */
	delete: async ({ locals, params }) => {
		if (!SAFE_ID.test(params.id)) error(404, 'Övningen finns inte');
		try {
			await deleteExercise(storageFor(locals), params.id);
		} catch (e) {
			if (e instanceof ValidationError) return fail(400, { deleteError: e.issues.join(' ') });
			if (e instanceof StorageConflictError) return fail(409, { deleteError: 'Övningen ändrades samtidigt. Försök igen.' });
			throw e;
		}
		redirect(303, '/historik');
	}
};
