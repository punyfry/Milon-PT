import { error, fail } from '@sveltejs/kit';
import { SAFE_ID, ValidationError } from '$lib/model';
import { bestSet, metricFor, progressSeries, recordEntries } from '$lib/history/stats';
import { volume } from '$lib/session/active';
import { getExercise, typeLockReason, updateExerciseDetails } from '$lib/server/data';
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

	return {
		exercise: { id: ex.id, name: ex.name, type: ex.type, archived: ex.archived, instruction: ex.instruction, typeLock: await typeLockReason(storage, ex) },
		metric: metricFor(ex.type),
		points: progressSeries(ex).map((p) => ({ date: p.date, value: p.value })),
		entries: ex.log.slice(0, 15).map((e, i) => ({
			sessionId: e.sessionId ?? null,
			date: e.date,
			sets: e.sets,
			note: e.note ?? null,
			best: bestSet(ex.type, e.sets)?.value ?? null,
			volume: volume(ex.type, e.sets),
			record: records.get(i) ?? []
		}))
	};
};

export const actions: Actions = {
	/** Changes name, type and instruction. */
	edit: async ({ locals, params, request }) => {
		if (!SAFE_ID.test(params.id)) error(404, 'Övningen finns inte');
		const form = await request.formData();
		const input = { name: form.get('name'), type: form.get('type'), instruction: form.get('instruction') ?? '' };
		try {
			await updateExerciseDetails(storageFor(locals), params.id, input);
		} catch (e) {
			if (e instanceof ValidationError) return fail(400, { editError: e.issues.join(' ') });
			if (e instanceof StorageConflictError) return fail(409, { editError: 'Övningen ändrades samtidigt. Försök igen.' });
			throw e;
		}
		return { edited: true };
	}
};
