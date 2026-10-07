import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import type { CreateMessage } from './models';
import { consumeAiCall, dailyLimit } from './usage';
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
 * Räknar ett anrop mot dagens gräns (AI_DAILY_LIMIT, standard 200 per
 * användare). Kastar AiLimitError när gränsen är nådd.
 */
export function countAiCall(storage: UserStorage): Promise<number> {
	return consumeAiCall(storage, todayInStockholm(), dailyLimit(env.AI_DAILY_LIMIT));
}
