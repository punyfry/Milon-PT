import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';
import { ValidationError } from '$lib/model';
import { assertAiCallsLeft, helperModel, isAiConfigured, limitedCreateMessage } from '$lib/server/ai/client';
import { AiLimitError } from '$lib/server/ai/usage';
import { askHelper, parseHelperInput } from '$lib/server/helper/ask';
import { storageFor } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** Hjälparen under passet: { session, exerciseId, history, question } → { reply, swap }. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const storage = storageFor(locals);
	if (!isAiConfigured()) error(503, 'ANTHROPIC_API_KEY saknas på servern');
	const body: unknown = await request.json().catch(() => null);
	let input;
	try {
		input = parseHelperInput(body);
	} catch (e) {
		if (e instanceof ValidationError) error(400, e.issues.join('; '));
		throw e;
	}
	try {
		await assertAiCallsLeft(storage);
		return json(await askHelper(storage, input, { model: helperModel(), createMessage: limitedCreateMessage(storage) }));
	} catch (e) {
		if (e instanceof AiLimitError) error(429, e.message);
		console.error('Hjälparen:', e);
		if (e instanceof Anthropic.RateLimitError) error(429, 'Milon är upptagen just nu. Försök igen om en stund.');
		if (e instanceof Anthropic.APIError) error(502, 'Milon kunde inte svara just nu. Försök igen.');
		throw e;
	}
};
