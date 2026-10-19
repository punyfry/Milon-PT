import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { coachEnabled, type Profile } from '../../model';
import type { CreateMessage } from './models';
import { AiLimitError, consumeAiCall, dailyLimit, recordTokens, remainingAiCalls, starterCalls, type AiLimits } from './usage';
import type { UserStorage } from '../storage/types';
import { todayInStockholm } from '../../time';

/** Default models when the environment variables are missing: Sonnet for the builder, Haiku 4.5 for the helper. */
export const DEFAULT_BUILDER_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_HELPER_MODEL = 'claude-haiku-4-5';

let client: Anthropic | null = null;

export function builderModel(): string {
	return env.MODEL_BUILDER?.trim() || DEFAULT_BUILDER_MODEL;
}

export function helperModel(): string {
	return env.MODEL_HELPER?.trim() || DEFAULT_HELPER_MODEL;
}

export function isAiConfigured(): boolean {
	return Boolean(env.ANTHROPIC_API_KEY);
}

/** Milon can be used: the API key is set and the user has not turned him off. */
export function aiAvailable(profile: Profile): boolean {
	return isAiConfigured() && coachEnabled(profile);
}

export const COACH_OFF_MESSAGE = 'Milon är avstängd. Du kan slå på honom under Konto.';

/** Calls the Claude API. The key is read only on the server and never reaches the client. */
export const createMessage: CreateMessage = (params) => {
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client.beta.messages.create(params);
};

/** AI_DAILY_LIMIT (default 50 per user and day) and AI_STARTER_CALLS (default 100, a new user's first two weeks). */
function aiLimits(): AiLimits {
	return { daily: dailyLimit(env.AI_DAILY_LIMIT), starter: starterCalls(env.AI_STARTER_CALLS) };
}

/**
 * createMessage that counts every call against today's limit, then the starter
 * pot, and throws AiLimitError once both are used up. The response's token
 * usage is recorded per model (#98); the served model is used, which can differ
 * from the requested one after a server-side fallback.
 */
export function limitedCreateMessage(storage: UserStorage, inner: CreateMessage = createMessage): CreateMessage {
	return async (params) => {
		const today = todayInStockholm();
		await consumeAiCall(storage, today, aiLimits());
		const response = await inner(params);
		await recordTokens(storage, today, response?.model || params.model, response?.usage);
		return response;
	};
}

/** Throws AiLimitError if today's limit and the starter pot are used up. Counts nothing. */
export async function assertAiCallsLeft(storage: UserStorage): Promise<void> {
	const limits = aiLimits();
	if ((await remainingAiCalls(storage, todayInStockholm(), limits)) === 0) throw new AiLimitError(limits.daily);
}
