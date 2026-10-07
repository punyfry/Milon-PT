import type Anthropic from '@anthropic-ai/sdk';
import { AiLimitError } from '../ai/usage';
import { isObject, type WorkoutExercise } from '../../model';
import { modelOptions, type CreateMessage } from '../ai/models';
import { listExercises } from '../data/exercises';
import { getProfile } from '../data/profile';
import { getLatestWorkout } from '../data/workouts';
import type { UserStorage } from '../storage/types';
import { buildSystemPrompt } from './prompt';
import { BUILDER_TOOLS, executeTool, type BuilderState } from './tools';

/** En rad i chattloggen som visas för användaren. */
export interface LogItem {
	role: 'user' | 'assistant' | 'event' | 'error';
	text: string;
}

/**
 * En pass-byggar-konversation, sparad som `builder/<id>.json`.
 * `system` fryses vid start och `messages` växer bara (append-only): tidigare
 * turer, inklusive tankeblock, skickas alltid tillbaka exakt som de kom.
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

/** Startar en ny konversation, för ett nytt pass eller för att redigera `editSlug`. */
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

// --- en tur -------------------------------------------------------------

export type { CreateMessage };

export interface TurnOptions {
	model: string;
	today: string;
	createMessage: CreateMessage;
	/** Högsta antal modellanrop per tur (verktygsrundor). */
	maxIterations?: number;
}

export function requestParams(conversation: BuilderConversation, model: string): Anthropic.Beta.MessageCreateParamsNonStreaming {
	return {
		model,
		max_tokens: 16000,
		// Systemprompten är fryst per konversation och cachas; resten cachas
		// automatiskt vid sista blocket, så varje tur bara betalar för det nya.
		system: [{ type: 'text', text: conversation.system, cache_control: { type: 'ephemeral' } }],
		cache_control: { type: 'ephemeral' },
		tools: BUILDER_TOOLS,
		messages: conversation.messages,
		...modelOptions(model, 'medium')
	};
}

/**
 * Kör en användartur: skickar meddelandet, utför verktygsanrop och låter
 * modellen svara tills den är klar. Ändrar `conversation` på plats. Kastar
 * API-fel vidare efter att ha loggat dem, så att det som hunnit hända
 * (t.ex. skapade övningar) ändå kan sparas av anroparen.
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

		// Hela svaret sparas oförändrat (tanke-, fallback- och verktygsblock).
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
			// Ett avklippt verktygsanrop körs aldrig; modellen får veta det nästa tur.
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
			// Varje tool_use måste följas av ett tool_result, annars avvisar API:t
			// resten av konversationen. Även oväntade fel (t.ex. lagringen) blir
			// därför ett felsvar till modellen.
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

// --- vy -----------------------------------------------------------------

export interface DraftItem extends WorkoutExercise {
	name: string;
	type: string;
}

/** Det klienten får: chattloggen och live-listan med namn, aldrig modellens råa meddelanden. */
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
