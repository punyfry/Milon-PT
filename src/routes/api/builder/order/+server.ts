import { error, json } from '@sveltejs/kit';
import { coachEnabled, isObject } from '$lib/model';
import { COACH_OFF_MESSAGE } from '$lib/server/ai/client';
import {
	conversationView,
	loadConversation,
	reorderDraft,
	saveConversation,
	startConversation,
	type BuilderConversation
} from '$lib/server/builder/conversation';
import { getProfile, listExercises } from '$lib/server/data';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * The user's own order for the workout builder's list: { order, conversationId?, editSlug? }.
 * `order` is the exercise ids in the new order. No AI call: Milon is told with the next message.
 * Without conversationId a conversation is started for `editSlug`, since only a workout being
 * edited has a list before the first message.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const storage = storageFor(locals);
	if (!coachEnabled((await getProfile(storage)).data)) error(403, COACH_OFF_MESSAGE);

	const body: unknown = await request.json().catch(() => null);
	if (!isObject(body)) error(400, 'Ogiltig JSON');

	let conversation: BuilderConversation;
	let version: string | undefined;
	if (typeof body.conversationId === 'string') {
		const loaded = await loadConversation(storage, body.conversationId);
		if (!loaded) error(404, 'Konversationen finns inte');
		({ conversation, version } = loaded);
	} else {
		const editSlug = typeof body.editSlug === 'string' && /^[a-z0-9-]+$/.test(body.editSlug) ? body.editSlug : null;
		if (!editSlug) error(400, 'Det finns inget pass att ändra ordning på.');
		try {
			conversation = await startConversation(storage, editSlug);
		} catch {
			error(404, 'Passet finns inte');
		}
	}

	const names = new Map((await listExercises(storage)).map((e) => [e.data.id, e.data.name]));
	const problem = reorderDraft(conversation, body.order, names);
	if (problem) error(400, problem);

	try {
		await saveConversation(storage, conversation, version);
	} catch (e) {
		if (e instanceof StorageConflictError) error(409, 'Konversationen ändrades i ett annat fönster. Ladda om sidan.');
		throw e;
	}
	return json(await conversationView(storage, conversation));
};
