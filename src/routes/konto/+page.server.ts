import { fail } from '@sveltejs/kit';
import { ValidationError, coachEnabled, coachNotes, parseNotes, sameNotes, withNotes, type Profile } from '$lib/model';
import { isAiConfigured } from '$lib/server/ai/client';
import { canImport } from '$lib/server/allowlist';
import { deleteAccount, getProfile, saveProfile } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { UserStorage } from '$lib/server/storage/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const profile = await getProfile(storageFor(locals));
	return {
		user: locals.user,
		weeklySessionGoal: profile.data.weeklySessionGoal ?? null,
		coach: coachEnabled(profile.data),
		/** What Milon knows about the user (#110). */
		notes: coachNotes(profile.data),
		aiConfigured: isAiConfigured(),
		canImport: canImport(locals.user?.email)
	};
};

/**
 * Reads the profile, applies `change` and saves it. False if it was changed at the same time,
 * or if `change` returns false (what it was to change is no longer there).
 */
async function updateProfile(storage: UserStorage, change: (profile: Profile) => Profile | void | false): Promise<boolean> {
	const current = await getProfile(storage);
	let profile: Profile = { ...current.data };
	const result = change(profile);
	if (result === false) return false;
	if (result) profile = result;
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
	},

	/** Removes one rule or line from what Milon knows (#110). The text is sent, so a changed list removes nothing else. */
	forget: async ({ locals, request }) => {
		const form = await request.formData();
		const kind = form.get('kind');
		const text = form.get('text');
		if ((kind !== 'rules' && kind !== 'context') || typeof text !== 'string') return fail(400, { notesError: 'Ogiltig rad.' });
		const saved = await updateProfile(storageFor(locals), (profile) => {
			const notes = coachNotes(profile);
			if (!notes[kind].includes(text)) return false;
			return withNotes(profile, { ...notes, [kind]: notes[kind].filter((x) => x !== text) });
		});
		if (!saved) return fail(409, { notesError: 'Listan ändrades samtidigt. Försök igen.' });
		return { notesSaved: true };
	},

	/**
	 * Saves Milon's proposal (from /api/notes) once the user approves it. `base` is what the
	 * proposal was made from; if the notes changed since, nothing is saved.
	 */
	notes: async ({ locals, request }) => {
		const form = await request.formData();
		let base, proposal;
		try {
			base = parseNotes(JSON.parse(String(form.get('base') ?? '')));
			proposal = parseNotes(JSON.parse(String(form.get('proposal') ?? '')));
		} catch (e) {
			if (e instanceof ValidationError) return fail(400, { notesError: e.issues.join(' ') });
			if (e instanceof SyntaxError) return fail(400, { notesError: 'Ogiltigt förslag.' });
			throw e;
		}
		const saved = await updateProfile(storageFor(locals), (profile) => sameNotes(coachNotes(profile), base) && withNotes(profile, proposal));
		if (!saved) return fail(409, { notesError: 'Listan ändrades samtidigt. Fråga Milon igen.' });
		return { notesSaved: true };
	},

	/**
	 * Deletes everything the user has saved. The page then empties the browser's copy
	 * and signs out. The address stays on the allowlist, so signing in again starts over.
	 */
	deleteAccount: async ({ locals }) => {
		try {
			await deleteAccount(storageFor(locals));
		} catch (e) {
			console.error('Could not delete account:', e);
			return fail(500, { deleteError: 'Kontot kunde inte raderas helt. Försök igen.' });
		}
		return { accountDeleted: true };
	}
};
