import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import type { CreateMessage } from './conversation';

/** Standardmodell för pass-byggaren när MODEL_BUILDER saknas (SPEC.md: Sonnet). */
export const DEFAULT_BUILDER_MODEL = 'claude-sonnet-5-5';

let client: Anthropic | null = null;

export function builderModel(): string {
	return env.MODEL_BUILDER?.trim() || DEFAULT_BUILDER_MODEL;
}

export function isBuilderConfigured(): boolean {
	return Boolean(env.ANTHROPIC_API_KEY);
}

/** Anropar Claude API. Nyckeln läses bara på servern och når aldrig klienten. */
export const createMessage: CreateMessage = (params) => {
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client.beta.messages.create(params);
};
