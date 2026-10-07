import type Anthropic from '@anthropic-ai/sdk';

/** The Messages API call, replaceable in tests. */
export type CreateMessage = (
	params: Anthropic.Beta.MessageCreateParamsNonStreaming
) => Promise<Anthropic.Beta.BetaMessage>;

/** Models that accept `fallbacks: "default"` (server-side fallback on a declined response). */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

/**
 * Model-specific parameters. Haiku 4.5 has no adaptive thinking or effort;
 * the other current models get adaptive thinking with the given effort.
 * Server-side fallback is only requested where the model supports it.
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
