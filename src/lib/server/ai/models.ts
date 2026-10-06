import type Anthropic from '@anthropic-ai/sdk';

/** Anropet mot Messages API, utbytbart i tester. */
export type CreateMessage = (
	params: Anthropic.Beta.MessageCreateParamsNonStreaming
) => Promise<Anthropic.Beta.BetaMessage>;

/** Modeller som tar emot `fallbacks: "default"` (server-side fallback vid avböjt svar). */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

/**
 * Modellberoende parametrar. Haiku 4.5 har inte adaptivt tänkande eller
 * effort; övriga aktuella modeller får adaptivt tänkande med angiven effort.
 * Server-side fallback begärs bara där modellen stöder det.
 */
export function modelOptions(
	model: string,
	effort: 'low' | 'medium' | 'high'
): Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, 'thinking' | 'output_config' | 'betas' | 'fallbacks'> {
	return {
		...(model.startsWith('claude-haiku') ? {} : { thinking: { type: 'adaptive' as const }, output_config: { effort } }),
		...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
	};
}
