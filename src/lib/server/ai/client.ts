import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import type { CreateMessage } from './models';
import { AiLimitError, consumeAiCall, dailyLimit, remainingAiCalls } from './usage';
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

/** Calls the Claude API. The key is read only on the server and never reaches the client. */
export const createMessage: CreateMessage = (params) => {
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client.beta.messages.create(params);
};

/**
 * createMessage that counts every call against today's limit (AI_DAILY_LIMIT,
 * default 200 per user) and throws AiLimitError once it is reached.
 */
export function limitedCreateMessage(storage: UserStorage, inner: CreateMessage = createMessage): CreateMessage {
	return async (params) => {
		await consumeAiCall(storage, todayInStockholm(), dailyLimit(env.AI_DAILY_LIMIT));
		return inner(params);
	};
}

/** Throws AiLimitError if today's limit is already reached. Counts nothing. */
export async function assertAiCallsLeft(storage: UserStorage): Promise<void> {
	const limit = dailyLimit(env.AI_DAILY_LIMIT);
	if ((await remainingAiCalls(storage, todayInStockholm(), limit)) === 0) throw new AiLimitError(limit);
}
