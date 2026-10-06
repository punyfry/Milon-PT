import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createExercise, getExercise, listLatestWorkouts, saveProfile, saveWorkoutVersion } from '../data';
import { MemoryUserStorage } from '../storage/memory';
import { requestParams, runTurn, startConversation, type CreateMessage } from './conversation';
import { buildSystemPrompt } from './prompt';
import { executeTool, type BuilderState } from './tools';

const TODAY = '2026-10-06';

async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Marklyft', type: 'weight', loadClass: 'heavy', instruction: 'Rak rygg.' });
	await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
	return storage;
}

function message(content: Anthropic.Beta.BetaContentBlock[], stop: Anthropic.Beta.BetaStopReason): Anthropic.Beta.BetaMessage {
	return { id: 'msg', type: 'message', role: 'assistant', model: 'test', content, stop_reason: stop } as Anthropic.Beta.BetaMessage;
}
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.Beta.BetaTextBlock;
const toolUse = (id: string, name: string, input: unknown) =>
	({ type: 'tool_use', id, name, input }) as Anthropic.Beta.BetaToolUseBlock;
const thinking = { type: 'thinking', thinking: '', signature: 'sig-1' } as Anthropic.Beta.BetaThinkingBlock;

/** Spelar upp förinspelade svar och sparar vad som skickades. */
function scripted(...responses: Anthropic.Beta.BetaMessage[]) {
	const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
	const create: CreateMessage = async (params) => {
		calls.push(structuredClone(params));
		const next = responses.shift();
		if (!next) throw new Error('inga fler svar');
		return next;
	};
	return { create, calls };
}

const newExercise = {
	existingId: null,
	name: 'Hantelrodd',
	type: 'weight',
	loadClass: 'light',
	instruction: 'Stöd mot bänk.\nDra armbågen bakåt.',
	sets: 3,
	target: { reps: 10, seconds: null }
};

describe('systemprompt', () => {
	it('fyller i mål, katalog och passet som redigeras', async () => {
		const storage = await setup();
		const ex = (await getExercise(storage, 'ex_marklyft'))!.data;
		const prompt = buildSystemPrompt(
			{ goals: 'Bli starkare $& snabbt', rules: ['Max 45 min'] },
			[ex],
			{ slug: 'pass-a', name: 'Pass A', version: 2, createdAt: TODAY, exercises: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }] }
		);
		expect(prompt).toContain('Mål: Bli starkare $& snabbt\n- Max 45 min');
		expect(prompt).toContain('ex_marklyft | Marklyft | weight | heavy');
		expect(prompt).toContain('Pass A (version 2)\n1. Marklyft (ex_marklyft): 3 set × 8 reps');
		expect(buildSystemPrompt({}, [], null)).toContain('(inga angivna)');
	});
});

describe('verktyg', () => {
	it('propose_exercise skapar ny övning, återanvänder befintlig och uppdaterar live-listan', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };

		const created = await executeTool(storage, state, 'propose_exercise', newExercise, TODAY);
		expect(created).toMatchObject({ isError: false, event: 'Lade till Hantelrodd: 3 set × 10 reps (ny övning)' });
		expect((await getExercise(storage, 'ex_hantelrodd'))!.data).toMatchObject({ type: 'weight', loadClass: 'light' });

		// Samma namn igen skapar ingen dubblett, utan uppdaterar setet.
		const again = await executeTool(storage, state, 'propose_exercise', { ...newExercise, name: 'hantelrodd', sets: 4 }, TODAY);
		expect(again.event).toBe('Uppdaterade Hantelrodd: 4 set × 10 reps');

		await executeTool(storage, state, 'propose_exercise', { ...newExercise, existingId: 'ex_plankan', name: null, target: { reps: null, seconds: 45 } }, TODAY);
		expect(state.draft).toEqual([
			{ exerciseId: 'ex_hantelrodd', sets: 4, target: { reps: 10 } },
			{ exerciseId: 'ex_plankan', sets: 3, target: { seconds: 45 } }
		]);
		expect((await storage.list('exercises/')).length).toBe(3);
	});

	it('propose_exercise svarar med fel som modellen kan rätta', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };
		const bad = async (input: unknown) => (await executeTool(storage, state, 'propose_exercise', input, TODAY)).content;
		expect(await bad({ ...newExercise, existingId: 'ex_finns_inte' })).toMatch(/ingen övning med id/);
		expect(await bad({ ...newExercise, loadClass: null })).toMatch(/loadClass/);
		expect(await bad({ ...newExercise, existingId: 'ex_plankan' })).toMatch(/seconds/);
		expect(await bad({ ...newExercise, target: { reps: 8, seconds: 30 } })).toMatch(/antingen reps eller seconds/);
		expect(state.draft).toEqual([]);
	});

	it('set_workout sparar nytt pass som v1 och sedan nästa version', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };
		const input = {
			name: 'Pass C',
			changeNote: 'Nytt pass',
			exercises: [
				{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 5, seconds: null } },
				{ exerciseId: 'ex_plankan', sets: 2, target: { reps: null, seconds: 60 } }
			]
		};
		expect(await executeTool(storage, state, 'set_workout', input, TODAY)).toMatchObject({ isError: false, event: 'Sparade Pass C (version 1)' });
		expect(state).toMatchObject({ editingSlug: 'pass-c', saved: { slug: 'pass-c', version: 1 } });

		const v2 = await executeTool(storage, state, 'set_workout', { ...input, changeNote: 'Fler set', exercises: [input.exercises[0]] }, TODAY);
		expect(v2.event).toBe('Sparade Pass C (version 2)');
		const [latest] = await listLatestWorkouts(storage);
		expect(latest).toMatchObject({ version: 2, changeNote: 'Fler set', createdAt: TODAY });
		expect((await storage.list('workouts/')).length).toBe(2);
	});

	it('set_workout skriver aldrig över ett annat pass med samma namn', async () => {
		const storage = await setup();
		await saveWorkoutVersion(storage, { slug: 'pass-a', name: 'Pass A', createdAt: TODAY, exercises: [] });
		const state: BuilderState = { editingSlug: null, draft: [] };
		const result = await executeTool(
			storage,
			state,
			'set_workout',
			{ name: 'Pass A', changeNote: '', exercises: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 5, seconds: null } }] },
			TODAY
		);
		expect(result).toMatchObject({ isError: true });
		expect((await storage.list('workouts/')).length).toBe(1);
	});

	it('set_workout avvisar okända övningar och fel måltyp', async () => {
		const storage = await setup();
		const result = await executeTool(
			storage,
			{ editingSlug: null, draft: [] },
			'set_workout',
			{
				name: 'Pass X',
				changeNote: '',
				exercises: [
					{ exerciseId: 'ex_okand', sets: 3, target: { reps: 5, seconds: null } },
					{ exerciseId: 'ex_plankan', sets: 3, target: { reps: 5, seconds: null } }
				]
			},
			TODAY
		);
		expect(result.content).toMatch(/okänt exerciseId ex_okand.*seconds/);
		expect(await storage.list('workouts/')).toEqual([]);
	});
});

describe('en tur', () => {
	it('kör verktyg, skickar tillbaka svaren och loggar för användaren', async () => {
		const storage = await setup();
		await saveProfile(storage, { goals: 'Styrka' });
		const conversation = await startConversation(storage, null);
		const { create, calls } = scripted(
			message([thinking, text('Bra val, jag lägger till hantelrodd.'), toolUse('t1', 'propose_exercise', newExercise)], 'tool_use'),
			message([text('Klart. Något mer?')], 'end_turn')
		);

		await runTurn(storage, conversation, 'Ja, ta med hantelrodd', { model: 'claude-sonnet-5-5', today: TODAY, createMessage: create });

		expect(conversation.log).toEqual([
			{ role: 'user', text: 'Ja, ta med hantelrodd' },
			{ role: 'assistant', text: 'Bra val, jag lägger till hantelrodd.' },
			{ role: 'event', text: 'Lade till Hantelrodd: 3 set × 10 reps (ny övning)' },
			{ role: 'assistant', text: 'Klart. Något mer?' }
		]);
		// Andra anropet innehåller hela första svaret oförändrat (inkl. tankeblocket) och verktygssvaret.
		const second = calls[1].messages;
		expect(second[1]).toEqual({ role: 'assistant', content: [thinking, text('Bra val, jag lägger till hantelrodd.'), toolUse('t1', 'propose_exercise', newExercise)] });
		expect(second[2].content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 't1' })]);
		// Systemprompten är densamma i båda anropen.
		expect(calls[0].system).toEqual(calls[1].system);
		expect(JSON.stringify(calls[0].system)).toContain('Mål: Styrka');
	});

	it('loggar API-fel men behåller det som hunnit hända', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		const { create } = scripted(message([toolUse('t1', 'propose_exercise', newExercise)], 'tool_use'));
		await expect(
			runTurn(storage, conversation, 'Lägg till hantelrodd', { model: 'm', today: TODAY, createMessage: create })
		).rejects.toThrow();
		expect(conversation.draft).toHaveLength(1);
		expect(conversation.log.at(-1)).toMatchObject({ role: 'error' });
	});

	it('kör aldrig ett avklippt verktygsanrop', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		const { create } = scripted(message([toolUse('t1', 'propose_exercise', { existingId: null })], 'max_tokens'));
		await runTurn(storage, conversation, 'x', { model: 'm', today: TODAY, createMessage: create });
		expect(conversation.draft).toEqual([]);
		expect(conversation.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', is_error: true }] });
	});

	it('redigering startar med passets övningar i live-listan', async () => {
		const storage = await setup();
		await saveWorkoutVersion(storage, {
			slug: 'pass-a',
			name: 'Pass A',
			createdAt: TODAY,
			exercises: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }]
		});
		const conversation = await startConversation(storage, 'pass-a');
		expect(conversation.editingSlug).toBe('pass-a');
		expect(conversation.draft).toEqual([{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }]);
		expect(conversation.system).toContain('Pass A (version 1)');
		await expect(startConversation(storage, 'finns-inte')).rejects.toThrow();
	});

	it('begär fallback bara för modeller som stöder det', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		expect(requestParams(conversation, 'claude-sonnet-5-5')).toMatchObject({
			fallbacks: 'default',
			betas: ['server-side-fallback-2026-07-01'],
			thinking: { type: 'adaptive' },
			output_config: { effort: 'medium' }
		});
		const haiku = requestParams(conversation, 'claude-haiku-4-5');
		expect(haiku).not.toHaveProperty('fallbacks');
		expect(haiku).not.toHaveProperty('thinking');
	});
});

describe('lagringsfel i ett verktygsanrop', () => {
	/** Lagring som kastar när en övning ska skrivas, t.ex. ett nätverksfel mot Blob. */
	class FailingWrites extends MemoryUserStorage {
		failing = true;
		override async writeJson(path: string, data: unknown, options?: Parameters<MemoryUserStorage['writeJson']>[2]) {
			if (this.failing && path.startsWith('exercises/')) throw new Error('nätverksfel');
			return super.writeJson(path, data, options);
		}
	}

	it('ger ett felsvar till modellen så att konversationen förblir giltig', async () => {
		const storage = new FailingWrites('u1');
		const conversation = await startConversation(storage, null);
		const { create, calls } = scripted(
			message([toolUse('t1', 'propose_exercise', newExercise)], 'tool_use'),
			message([text('Det gick inte att spara just nu.')], 'end_turn'),
			message([text('Nu gick det.')], 'end_turn')
		);

		await runTurn(storage, conversation, 'Lägg till hantelrodd', { model: 'm', today: TODAY, createMessage: create });

		// Varje tool_use följs av ett tool_result, så nästa anrop är giltigt.
		expect(conversation.messages[2]).toMatchObject({
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }]
		});
		expect(conversation.log).toContainEqual({ role: 'error', text: 'Kunde inte spara: nätverksfel' });
		expect(conversation.draft).toEqual([]);

		storage.failing = false;
		await runTurn(storage, conversation, 'Försök igen', { model: 'm', today: TODAY, createMessage: create });
		expect(calls).toHaveLength(3);
		expect(conversation.log.at(-1)).toEqual({ role: 'assistant', text: 'Nu gick det.' });
	});
});

describe('verktygsscheman', () => {
	/** Går igenom alla delscheman i ett JSON-schema. */
	function* nodes(schema: unknown): Generator<Record<string, unknown>> {
		if (Array.isArray(schema)) for (const s of schema) yield* nodes(s);
		else if (schema && typeof schema === 'object') {
			yield schema as Record<string, unknown>;
			for (const v of Object.values(schema)) yield* nodes(v);
		}
	}

	it('kombinerar aldrig enum med en lista av typer (avvisas av API:t för strict-verktyg)', async () => {
		const { BUILDER_TOOLS } = await import('./tools');
		for (const tool of BUILDER_TOOLS) {
			expect(tool.strict).toBe(true);
			for (const node of nodes(tool.input_schema)) {
				if ('enum' in node) {
					expect(typeof node.type, `${tool.name}: enum med type ${JSON.stringify(node.type)}`).toBe('string');
					expect(node.enum).not.toContain(null);
				}
				if (node.type === 'object') {
					expect(node.additionalProperties, tool.name).toBe(false);
					expect(Object.keys((node.properties as object) ?? {}).sort()).toEqual([...((node.required as string[]) ?? [])].sort());
				}
			}
		}
	});
});
