import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import type { CreateMessage } from './models';
import { AiLimitError, consumeAiCall, dailyLimit, remainingAiCalls } from './usage';
import type { UserStorage } from '../storage/types';
import { todayInStockholm } from '../../time';

/** Standardmodeller när miljövariablerna saknas: Sonnet för byggaren, Haiku 4.5 för hjälparen. */
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

/** Anropar Claude API. Nyckeln läses bara på servern och når aldrig klienten. */
export const createMessage: CreateMessage = (params) => {
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client.beta.messages.create(params);
};

/**
 * createMessage som räknar varje anrop mot dagens gräns (AI_DAILY_LIMIT,
 * standard 200 per användare) och kastar AiLimitError när den är nådd.
 */
export function limitedCreateMessage(storage: UserStorage, inner: CreateMessage = createMessage): CreateMessage {
	return async (params) => {
		await consumeAiCall(storage, todayInStockholm(), dailyLimit(env.AI_DAILY_LIMIT));
		return inner(params);
	};
}

/** Kastar AiLimitError om dagens gräns redan är nådd. Räknar inget. */
export async function assertAiCallsLeft(storage: UserStorage): Promise<void> {
	const limit = dailyLimit(env.AI_DAILY_LIMIT);
	if ((await remainingAiCalls(storage, todayInStockholm(), limit)) === 0) throw new AiLimitError(limit);
}
