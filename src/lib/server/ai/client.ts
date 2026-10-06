import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import type { CreateMessage } from './models';

/** Standardmodeller när miljövariablerna saknas (SPEC.md: Sonnet för byggaren, Haiku 4.5 för hjälparen). */
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
