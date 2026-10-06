import { fail } from '@sveltejs/kit';
import { getProfile, saveProfile } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const profile = await getProfile(storageFor(locals));
	return { user: locals.user, weeklySessionGoal: profile.data.weeklySessionGoal ?? null };
};

export const actions: Actions = {
	/** Veckomålet (antal pass per vecka) som historikens veckovy jämför mot. */
	goal: async ({ locals, request }) => {
		const storage = storageFor(locals);
		const raw = String((await request.formData()).get('weeklySessionGoal') ?? '').trim();
		const goal = raw === '' ? undefined : /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
		if (goal !== undefined && (!Number.isInteger(goal) || goal < 0 || goal > 14)) {
			return fail(400, { goalError: 'Ange ett heltal mellan 0 och 14.' });
		}
		const current = await getProfile(storage);
		const profile = { ...current.data };
		if (goal) profile.weeklySessionGoal = goal;
		else delete profile.weeklySessionGoal;
		try {
			await saveProfile(storage, profile, current.version);
		} catch (e) {
			if (e instanceof StorageConflictError) return fail(409, { goalError: 'Profilen ändrades samtidigt. Försök igen.' });
			throw e;
		}
		return { goalSaved: true };
	}
};
