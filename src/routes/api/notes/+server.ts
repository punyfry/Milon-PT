import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';
import { ValidationError, coachEnabled } from '$lib/model';
import { COACH_OFF_MESSAGE, assertAiCallsLeft, helperModel, isAiConfigured, limitedCreateMessage } from '$lib/server/ai/client';
import { AiLimitError } from '$lib/server/ai/usage';
import { NotesProposalError, parseNotesRequest, proposeNotes } from '$lib/server/coach/notes';
import { getProfile } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * Milon proposes changes to what he knows about the user (#110): { change } → { base, proposal, summary }.
 * Nothing is saved; Konto saves the proposal when the user approves it.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const storage = storageFor(locals);
	if (!isAiConfigured()) error(503, 'ANTHROPIC_API_KEY saknas på servern');
	if (!coachEnabled((await getProfile(storage)).data)) error(403, COACH_OFF_MESSAGE);
	let change: string;
	try {
		change = parseNotesRequest(await request.json().catch(() => null));
	} catch (e) {
		if (e instanceof ValidationError) error(400, e.issues.join(' '));
		throw e;
	}
	try {
		await assertAiCallsLeft(storage);
		return json(await proposeNotes(storage, change, { model: helperModel(), createMessage: limitedCreateMessage(storage) }));
	} catch (e) {
		if (e instanceof AiLimitError) error(429, e.message);
		if (e instanceof NotesProposalError) error(502, e.message);
		console.error('Notes:', e);
		if (e instanceof Anthropic.RateLimitError) error(429, 'Milon är upptagen just nu. Försök igen om en stund.');
		if (e instanceof Anthropic.APIError) error(502, 'Milon kunde inte svara just nu. Försök igen.');
		throw e;
	}
};
