import { fail } from '@sveltejs/kit';
import { isAiConfigured } from '$lib/server/ai/client';
import { getProfile, saveProfile } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

/** The intro for a new user: Milon's story, the choice of having him or not, and a short tour. */
export const load: PageServerLoad = () => ({ aiConfigured: isAiConfigured() });

export const actions: Actions = {
	/**
	 * Marks the intro as done, with the choice of Milon (`coach` = on/off) when
	 * one was made. Skipping sends no choice and keeps the current setting.
	 */
	done: async ({ locals, request }) => {
		const coach = (await request.formData()).get('coach');
		if (coach !== null && coach !== 'on' && coach !== 'off') return fail(400, { error: 'Välj på eller av.' });
		const storage = storageFor(locals);
		const current = await getProfile(storage);
		const profile = { ...current.data, onboardedAt: current.data.onboardedAt ?? todayInStockholm() };
		if (coach !== null) profile.coach = coach === 'on';
		try {
			await saveProfile(storage, profile, current.version);
		} catch (e) {
			if (e instanceof StorageConflictError) return fail(409, { error: 'Profilen ändrades samtidigt. Försök igen.' });
			throw e;
		}
		return { done: true };
	}
};
