import type Anthropic from '@anthropic-ai/sdk';
import { AiLimitError } from '../ai/usage';
import { isObject, type WorkoutExercise } from '../../model';
import { modelOptions, type CreateMessage } from '../ai/models';
import { listExercises } from '../data/exercises';
import { getProfile } from '../data/profile';
import { getLatestWorkout } from '../data/workouts';
import { StorageConflictError, type UserStorage } from '../storage/types';
import { buildSystemPrompt } from './prompt';
import { BUILDER_TOOLS, executeTool, type BuilderState } from './tools';

/** A line in the chat log shown to the user. */
export interface LogItem {
	role: 'user' | 'assistant' | 'event' | 'error';
	text: string;
}

/**
 * A workout builder conversation, stored as `builder/<id>.json`.
 * `system` is frozen at start and `messages` is append-only: earlier turns,
 * including thinking blocks, are always sent back exactly as received.
 */
export interface BuilderConversation extends BuilderState {
	id: string;
	createdAt: string;
	system: string;
	messages: Anthropic.Beta.BetaMessageParam[];
	log: LogItem[];
}

const ID = /^b_[a-z0-9]{6,40}$/;
const path = (id: string) => `builder/${id}.json`;

export function newConversationId(now = Date.now()): string {
	return `b_${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadConversation(
	storage: UserStorage,
	id: string
): Promise<{ conversation: BuilderConversation; version: string } | null> {
	if (!ID.test(id)) return null;
	const file = await storage.readJson<BuilderConversation>(path(id));
	if (!file || !isObject(file.data) || !Array.isArray(file.data.messages)) return null;
	return { conversation: file.data, version: file.version };
}

/** Starts a new conversation, for a new workout or to edit `editSlug`. */
export async function startConversation(storage: UserStorage, editSlug: string | null): Promise<BuilderConversation> {
	const [profile, exercises, workout] = await Promise.all([
		getProfile(storage),
		listExercises(storage),
		editSlug ? getLatestWorkout(storage, editSlug) : Promise.resolve(null)
	]);
	if (editSlug && !workout) throw new Error(`Passet ${editSlug} finns inte`);
	return {
		id: newConversationId(),
		createdAt: new Date().toISOString(),
		editingSlug: workout?.slug ?? null,
		draft: workout ? structuredClone(workout.exercises) : [],
		system: buildSystemPrompt(
			profile.data,
			exercises.map((e) => e.data),
			workout
		),
		messages: [],
		log: []
	};
}

export async function saveConversation(storage: UserStorage, conversation: BuilderConversation, version?: string) {
	const result = await storage.writeJson(path(conversation.id), conversation, version ? { ifMatch: version } : { createOnly: true });
	return result.version;
}

/**
 * Saves a turn that started from `baseMessages` messages. If the version
 * check fails but the stored conversation still has exactly those messages,
 * nobody else added a turn (the stored version just didn't match), so the
 * turn is saved on top of it. Throws StorageConflictError if another turn
 * really was saved in between.
 */
export async function saveTurn(storage: UserStorage, conversation: BuilderConversation, version: string | undefined, baseMessages: number) {
	try {
		return await saveConversation(storage, conversation, version);
	} catch (e) {
		if (!(e instanceof StorageConflictError) || version === undefined) throw e;
		const stored = await loadConversation(storage, conversation.id);
		if (!stored || stored.conversation.messages.length !== baseMessages) throw e;
		return saveConversation(storage, conversation, stored.version);
	}
}

// --- a turn -------------------------------------------------------------

export type { CreateMessage };

export interface TurnOptions {
	model: string;
	today: string;
	createMessage: CreateMessage;
	/** Maximum number of model calls per turn (tool rounds). */
	maxIterations?: number;
}

export function requestParams(conversation: BuilderConversation, model: string): Anthropic.Beta.MessageCreateParamsNonStreaming {
	return {
		model,
		max_tokens: 16000,
		// The system prompt is frozen per conversation and cached; the rest is cached
		// automatically at the last block, so each turn only pays for what is new.
		system: [{ type: 'text', text: conversation.system, cache_control: { type: 'ephemeral' } }],
		cache_control: { type: 'ephemeral' },
		tools: BUILDER_TOOLS,
		messages: conversation.messages,
		...modelOptions(model, 'medium')
	};
}

/**
 * Runs a user turn: sends the message, executes tool calls and lets the
 * model respond until it is done. Mutates `conversation` in place. Rethrows
 * API errors after logging them, so that what already happened (e.g.
 * created exercises) can still be saved by the caller.
 */
export async function runTurn(
	storage: UserStorage,
	conversation: BuilderConversation,
	userText: string,
	options: TurnOptions
): Promise<void> {
	conversation.messages.push({ role: 'user', content: userText });
	conversation.log.push({ role: 'user', text: userText });

	const maxIterations = options.maxIterations ?? 8;
	for (let i = 0; i < maxIterations; i++) {
		let response: Anthropic.Beta.BetaMessage;
		try {
			response = await options.createMessage(requestParams(conversation, options.model));
		} catch (e) {
			const text = e instanceof AiLimitError ? e.message : 'Milon kunde inte svara just nu. Försök igen om en stund.';
			conversation.log.push({ role: 'error', text });
			throw e;
		}

		// The whole response is stored unchanged (thinking, fallback and tool blocks).
		conversation.messages.push({ role: 'assistant', content: response.content });
		for (const block of response.content) {
			if (block.type === 'text' && block.text.trim()) conversation.log.push({ role: 'assistant', text: block.text.trim() });
		}

		if (response.stop_reason === 'refusal') {
			conversation.log.push({ role: 'error', text: 'Milon kan inte hjälpa till med det. Försök formulera om.' });
			return;
		}

		const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
		if (response.stop_reason === 'max_tokens') {
			// A truncated tool call is never run; the model is told on the next turn.
			if (toolUses.length) {
				conversation.messages.push({
					role: 'user',
					content: toolUses.map((t) => ({
						type: 'tool_result' as const,
						tool_use_id: t.id,
						is_error: true,
						content: 'Svaret klipptes av innan verktygsanropet var klart. Försök igen, kortare.'
					}))
				});
			}
			conversation.log.push({ role: 'error', text: 'Svaret blev för långt och klipptes av.' });
			return;
		}
		if (response.stop_reason === 'pause_turn') continue;
		if (!toolUses.length) return;

		const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
		for (const tool of toolUses) {
			// Every tool_use must be followed by a tool_result, otherwise the API rejects
			// the rest of the conversation. So unexpected errors (e.g. storage) also
			// become an error result to the model.
			let outcome;
			try {
				outcome = await executeTool(storage, conversation, tool.name, tool.input, options.today);
			} catch (e) {
				const reason = e instanceof Error ? e.message : String(e);
				outcome = { isError: true, content: `Kunde inte spara: ${reason}. Be användaren försöka igen.` };
				conversation.log.push({ role: 'error', text: `Kunde inte spara: ${reason}` });
			}
			results.push({ type: 'tool_result', tool_use_id: tool.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
			if ('event' in outcome && outcome.event) conversation.log.push({ role: 'event', text: outcome.event });
		}
		conversation.messages.push({ role: 'user', content: results });
	}
	conversation.log.push({ role: 'error', text: 'Milon tog för många steg. Skriv igen för att fortsätta.' });
}

// --- view ---------------------------------------------------------------

export interface DraftItem extends WorkoutExercise {
	name: string;
	type: string;
}

/** What the client gets: the chat log and the live list with names, never the raw model messages. */
export async function conversationView(storage: UserStorage, conversation: BuilderConversation) {
	const names = new Map((await listExercises(storage)).map((e) => [e.data.id, e.data]));
	const draft: DraftItem[] = conversation.draft.map((d) => ({
		...d,
		name: names.get(d.exerciseId)?.name ?? d.exerciseId,
		type: names.get(d.exerciseId)?.type ?? 'weight'
	}));
	return {
		conversationId: conversation.id,
		editingSlug: conversation.editingSlug,
		saved: conversation.saved ?? null,
		log: conversation.log,
		draft
	};
}

export type ConversationView = Awaited<ReturnType<typeof conversationView>>;
