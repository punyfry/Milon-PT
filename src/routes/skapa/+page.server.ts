import { error, fail, redirect } from '@sveltejs/kit';
import { FactError, knownFacts, withFacts, type FactsToSave } from '$lib/builder/questionnaire';
import { getProfile, getWorkoutHistory, listExercises, listLatestWorkouts, saveProfile, type VersionSummary } from '$lib/server/data';
import { aiAvailable, builderModel } from '$lib/server/ai/client';
import { conversationView, loadConversation, type DraftItem } from '$lib/server/builder/conversation';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { Actions, PageServerLoad } from './$types';

/**
 * `/skapa` starts a new workout, `/skapa?pass=<slug>` edits a workout and
 * `/skapa?c=<id>` reopens an ongoing conversation. Without Milon (turned off,
 * or no API key) workouts are built by hand at `/skapa/manuell`.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const storage = storageFor(locals);
	const profile = (await getProfile(storage)).data;
	if (!aiAvailable(profile)) {
		const pass = url.searchParams.get('pass');
		redirect(307, pass ? `/skapa/manuell?${new URLSearchParams({ pass })}` : '/skapa/manuell');
	}

	const c = url.searchParams.get('c');
	const loaded = c ? await loadConversation(storage, c) : null;
	if (c && !loaded) error(404, 'Konversationen finns inte');
	const conversation = loaded ? await conversationView(storage, loaded.conversation) : null;

	const editSlug = conversation ? conversation.editingSlug : url.searchParams.get('pass');
	let versions: VersionSummary[] = [];
	let editing: { slug: string; name: string; version: number } | null = null;
	/** The workout's exercises before the conversation starts, so the list isn't empty when editing. */
	let initialDraft: DraftItem[] = [];
	if (editSlug) {
		const history = await getWorkoutHistory(storage, editSlug);
		if (!history) {
			if (!conversation) error(404, 'Passet finns inte');
		} else {
			versions = history.versions;
			const latest = history.latest;
			editing = { slug: latest.slug, name: latest.name, version: latest.version };
			if (!conversation) {
				const byId = new Map((await listExercises(storage)).map((e) => [e.data.id, e.data]));
				initialDraft = latest.exercises.map((e) => ({
					...e,
					name: byId.get(e.exerciseId)?.name ?? e.exerciseId,
					type: byId.get(e.exerciseId)?.type ?? 'weight'
				}));
			}
		}
	}

	const workouts = (await listLatestWorkouts(storage))
		.map((w) => ({ slug: w.slug, name: w.name }))
		.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

	return {
		model: builderModel(),
		conversation,
		editing,
		initialDraft,
		versions,
		workouts,
		/** For the questionnaire (#102): what Milon already knows about the user. */
		known: knownFacts(profile)
	};
};

export const actions: Actions = {
	/**
	 * Saves answers from the questionnaire to the profile (#102), only those the
	 * user chose to save: `place`, `experience` and `avoid`.
	 */
	profile: async ({ locals, request }) => {
		const form = await request.formData();
		const facts: FactsToSave = {};
		for (const key of ['place', 'experience', 'avoid'] as const) {
			const value = form.get(key);
			if (value === null) continue;
			if (typeof value !== 'string') return fail(400, { error: 'Ogiltigt svar.' });
			if (value.trim()) facts[key] = value;
		}
		const storage = storageFor(locals);
		const current = await getProfile(storage);
		try {
			await saveProfile(storage, withFacts(current.data, facts), current.version);
		} catch (e) {
			if (e instanceof FactError) return fail(400, { error: e.message });
			if (e instanceof StorageConflictError) return fail(409, { error: 'Profilen ändrades samtidigt. Försök igen.' });
			throw e;
		}
		return { saved: true };
	}
};
