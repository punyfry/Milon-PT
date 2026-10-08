import { error, redirect } from '@sveltejs/kit';
import { getProfile, getWorkoutHistory, listExercises, listLatestWorkouts, type VersionSummary } from '$lib/server/data';
import { aiAvailable, builderModel } from '$lib/server/ai/client';
import { conversationView, loadConversation } from '$lib/server/builder/conversation';
import { storageFor } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

/**
 * `/skapa` starts a new workout, `/skapa?pass=<slug>` edits a workout and
 * `/skapa?c=<id>` reopens an ongoing conversation. Without Milon (turned off,
 * or no API key) workouts are built by hand at `/skapa/manuell`.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const storage = storageFor(locals);
	if (!aiAvailable((await getProfile(storage)).data)) {
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
	let initialDraft: { exerciseId: string; sets: number; target: { reps: number } | { seconds: number }; name: string; type: string }[] = [];
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
		workouts
	};
};
