import { error } from '@sveltejs/kit';
import { bestSet, metricFor, progressSeries, recordEntries } from '$lib/history/stats';
import { volume } from '$lib/session/active';
import { getExercise } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

/** Graf över bästa set per pass och tabell över de senaste passen för en övning. */
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!/^[A-Za-z0-9_-]{1,100}$/.test(params.id)) error(404, 'Övningen finns inte');
	const stored = await getExercise(storageFor(locals), params.id);
	if (!stored) error(404, 'Övningen finns inte');
	const ex = stored.data;
	const records = recordEntries(ex);

	return {
		exercise: { id: ex.id, name: ex.name, type: ex.type, loadClass: ex.loadClass ?? null, instruction: ex.instruction },
		metric: metricFor(ex.type),
		points: progressSeries(ex).map((p) => ({ date: p.date, value: p.value })),
		entries: ex.log.slice(0, 15).map((e, i) => ({
			date: e.date,
			sets: e.sets,
			note: e.note ?? null,
			best: bestSet(ex.type, e.sets)?.value ?? null,
			volume: volume(ex.type, e.sets),
			record: records.has(i)
		}))
	};
};
