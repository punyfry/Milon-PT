import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';
import { isObject } from '$lib/model';
import { builderModel, createMessage, isAiConfigured } from '$lib/server/ai/client';
import {
	conversationView,
	loadConversation,
	runTurn,
	saveConversation,
	startConversation,
	type BuilderConversation
} from '$lib/server/builder/conversation';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { RequestHandler } from './$types';

const MAX_MESSAGE = 2000;

/**
 * En tur i pass-byggaren: { message, conversationId? , editSlug? }.
 * Utan conversationId startas en ny konversation (för `editSlug` om det anges).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const storage = storageFor(locals);
	if (!isAiConfigured()) error(503, 'ANTHROPIC_API_KEY saknas på servern');

	const body: unknown = await request.json().catch(() => null);
	if (!isObject(body)) error(400, 'Ogiltig JSON');
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	if (!message) error(400, 'Meddelandet är tomt');
	if (message.length > MAX_MESSAGE) error(400, `Meddelandet är för långt (max ${MAX_MESSAGE} tecken)`);

	let conversation: BuilderConversation;
	let version: string | undefined;
	if (typeof body.conversationId === 'string') {
		const loaded = await loadConversation(storage, body.conversationId);
		if (!loaded) error(404, 'Konversationen finns inte');
		({ conversation, version } = loaded);
	} else {
		const editSlug = typeof body.editSlug === 'string' && /^[a-z0-9-]+$/.test(body.editSlug) ? body.editSlug : null;
		try {
			conversation = await startConversation(storage, editSlug);
		} catch {
			error(404, 'Passet finns inte');
		}
	}

	let apiError: unknown = null;
	try {
		await runTurn(storage, conversation, message, {
			model: builderModel(),
			today: todayInStockholm(),
			createMessage
		});
	} catch (e) {
		apiError = e;
	}
	// Spara även efter fel, så att övningar och pass som hann skapas finns kvar i loggen.
	try {
		await saveConversation(storage, conversation, version);
	} catch (e) {
		if (e instanceof StorageConflictError) error(409, 'Konversationen ändrades i ett annat fönster. Ladda om sidan.');
		throw e;
	}

	if (apiError) {
		console.error('Pass-byggaren:', apiError);
		const status = apiError instanceof Anthropic.RateLimitError ? 429 : apiError instanceof Anthropic.APIError ? 502 : 500;
		return json({ ...(await conversationView(storage, conversation)), error: true }, { status });
	}
	return json(await conversationView(storage, conversation));
};
