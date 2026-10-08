import { fail } from '@sveltejs/kit';
import { coachEnabled, type Profile } from '$lib/model';
import { isAiConfigured } from '$lib/server/ai/client';
import { getProfile, saveProfile } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { UserStorage } from '$lib/server/storage/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const profile = await getProfile(storageFor(locals));
	return {
		user: locals.user,
		weeklySessionGoal: profile.data.weeklySessionGoal ?? null,
		coach: coachEnabled(profile.data),
		aiConfigured: isAiConfigured()
	};
};

/** Reads the profile, applies `change` and saves it. False if it was changed at the same time. */
async function updateProfile(storage: UserStorage, change: (profile: Profile) => void): Promise<boolean> {
	const current = await getProfile(storage);
	const profile = { ...current.data };
	change(profile);
	try {
		await saveProfile(storage, profile, current.version);
		return true;
	} catch (e) {
		if (e instanceof StorageConflictError) return false;
		throw e;
	}
}

export const actions: Actions = {
	/** Weekly goal (sessions per week) that the history week view compares against. */
	goal: async ({ locals, request }) => {
		const raw = String((await request.formData()).get('weeklySessionGoal') ?? '').trim();
		const goal = raw === '' ? undefined : /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
		if (goal !== undefined && (!Number.isInteger(goal) || goal < 0 || goal > 14)) {
			return fail(400, { goalError: 'Ange ett heltal mellan 0 och 14.' });
		}
		const saved = await updateProfile(storageFor(locals), (profile) => {
			if (goal) profile.weeklySessionGoal = goal;
			else delete profile.weeklySessionGoal;
		});
		if (!saved) return fail(409, { goalError: 'Profilen ändrades samtidigt. Försök igen.' });
		return { goalSaved: true };
	},

	/** Turns Milon, the AI coach, on or off. */
	coach: async ({ locals, request }) => {
		const value = (await request.formData()).get('coach');
		if (value !== 'on' && value !== 'off') return fail(400, { coachError: 'Välj på eller av.' });
		const saved = await updateProfile(storageFor(locals), (profile) => {
			profile.coach = value === 'on';
		});
		if (!saved) return fail(409, { coachError: 'Profilen ändrades samtidigt. Försök igen.' });
		return { coachSaved: true };
	}
};
