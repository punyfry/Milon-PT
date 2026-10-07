import { error } from '@sveltejs/kit';
import { getWorkout, listExercises, listLatestWorkouts, listWorkoutVersions } from '$lib/server/data';
import { builderModel, isAiConfigured } from '$lib/server/ai/client';
import { conversationView, loadConversation } from '$lib/server/builder/conversation';
import { storageFor } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

/**
 * `/skapa` starts a new workout, `/skapa?pass=<slug>` edits a workout and
 * `/skapa?c=<id>` reopens an ongoing conversation.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const storage = storageFor(locals);

	const c = url.searchParams.get('c');
	const loaded = c ? await loadConversation(storage, c) : null;
	if (c && !loaded) error(404, 'Konversationen finns inte');
	const conversation = loaded ? await conversationView(storage, loaded.conversation) : null;

	const editSlug = conversation ? conversation.editingSlug : url.searchParams.get('pass');
	let versions: { version: number; createdAt: string; changeNote: string | null; exerciseCount: number }[] = [];
	let editing: { slug: string; name: string; version: number } | null = null;
	/** The workout's exercises before the conversation starts, so the list isn't empty when editing. */
	let initialDraft: { exerciseId: string; sets: number; target: { reps: number } | { seconds: number }; name: string; type: string }[] = [];
	if (editSlug) {
		const numbers = (await listWorkoutVersions(storage)).get(editSlug);
		if (!numbers?.length) {
			if (!conversation) error(404, 'Passet finns inte');
		} else {
			const all = await Promise.all(numbers.map((v) => getWorkout(storage, editSlug, v)));
			versions = all
				.filter((w) => w !== null)
				.map((w) => ({
					version: w.data.version,
					createdAt: w.data.createdAt,
					changeNote: w.data.changeNote ?? null,
					exerciseCount: w.data.exercises.length
				}))
				.reverse();
			const latest = all[all.length - 1]!.data;
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
		configured: isAiConfigured(),
		model: builderModel(),
		conversation,
		editing,
		initialDraft,
		versions,
		workouts
	};
};
