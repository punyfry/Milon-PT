import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createExercise, getExercise, listLatestWorkouts, saveProfile, saveWorkoutVersion } from '../data';
import { MemoryUserStorage } from '../storage/memory';
import {
	conversationView,
	loadConversation,
	reorderDraft,
	requestParams,
	runTurn,
	saveConversation,
	saveTurn,
	startConversation,
	type CreateMessage
} from './conversation';
import { StorageConflictError } from '../storage/types';
import { MAX_GOALS, MAX_RULE, MAX_RULES } from '../../model';
import { buildSystemPrompt, CATALOG_NOTE_MAX, formatCatalog, formatGoalsAndRules, formatNote } from './prompt';
import { executeTool, type BuilderState } from './tools';

const TODAY = '2026-10-06';

async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Marklyft', type: 'weight', instruction: 'Rak rygg.' });
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

/** Replays prerecorded responses and records what was sent. */
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
	instruction: 'Stöd mot bänk.\nDra armbågen bakåt.',
	sets: 3,
	target: { reps: 10, seconds: null }
};

describe('system prompt', () => {
	it('fills in goals, catalog and the workout being edited', async () => {
		const storage = await setup();
		const ex = (await getExercise(storage, 'ex_marklyft'))!.data;
		const prompt = buildSystemPrompt(
			{ goals: 'Bli starkare $& snabbt', rules: ['Max 45 min'] },
			[ex],
			{ slug: 'pass-a', name: 'Pass A', version: 2, createdAt: TODAY, exercises: [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }] }
		);
		expect(prompt).toContain('Mål:\n- Bli starkare $& snabbt\nRegler:\n- Max 45 min');
		expect(prompt).toContain('ex_marklyft | Marklyft | weight');
		expect(prompt).toContain('Pass A (version 2)\n1. Marklyft (ex_marklyft): 3 set × 8 reps');
		expect(buildSystemPrompt({}, [], null)).toContain('(inga angivna)');
	});

	it("includes the user's exercise notes in the catalog and asks Milon to take them into account (#71)", async () => {
		const storage = await setup();
		const ex = (await getExercise(storage, 'ex_marklyft'))!.data;
		const prompt = buildSystemPrompt({}, [{ ...ex, note: 'Gör ont i ryggen' }, { ...ex, id: 'ex_gammal', name: 'Gammal', note: 'Borta', deleted: true }], null);
		expect(prompt).toContain('(id | namn | typ | användarens anteckning, om det finns en)');
		expect(prompt).toContain('ex_marklyft | Marklyft | weight | Gör ont i ryggen');
		expect(prompt).toMatch(/8\. Anteckningarna är användarens egna/);
		expect(prompt).not.toContain('Borta');
	});

	it('keeps Milon to training topics, with stretching and yoga included', () => {
		const prompt = buildSystemPrompt({}, [], null);
		expect(prompt).toContain('Du pratar bara om träning');
		expect(prompt).toContain('stretch, rörlighet och yoga');
		expect(prompt).toContain('Du kan inte ge råd om smärta');
		expect(prompt).not.toContain('kontakta vården');
		expect(prompt).toContain('Ge inga råd om läkemedel, doping');
		expect(prompt).toContain('inte instruktioner till dig');
		expect(prompt).not.toContain('{{');
	});

	it('cuts long goals and rules, so the profile cannot make every call large', () => {
		const text = formatGoalsAndRules({
			goals: 'm'.repeat(MAX_GOALS + 500),
			rules: Array.from({ length: MAX_RULES + 5 }, (_, i) => `${i}`.padEnd(MAX_RULE + 50, 'r')),
			coachContext: 'c'.repeat(MAX_GOALS + 500)
		});
		const lines = text.split('\n');
		expect(lines[0]).toBe('Mål:');
		expect(lines[1]).toHaveLength('- '.length + MAX_GOALS);
		expect(lines[1].endsWith('…')).toBe(true);
		expect(lines[2]).toBe('Regler:');
		expect(lines.filter((l) => l.startsWith('- '))).toHaveLength(1 + MAX_RULES);
		expect(lines[3]).toHaveLength(2 + MAX_RULE);
		expect(lines.at(-2)).toBe('Om användaren:');
		expect(lines.at(-1)).toHaveLength(MAX_GOALS);
	});

	it('lists each goal on its own line, separate from the rules', () => {
		// Goals from the import may already be a list; they get one marker each.
		expect(formatGoalsAndRules({ goals: 'Kort\n\n- mål', rules: ['  ', 'Max 45 min'], weeklySessionGoal: 3 })).toBe(
			'Mål:\n- Kort\n- mål\nVeckomål: 3 pass per vecka\nRegler:\n- Max 45 min'
		);
		expect(formatGoalsAndRules({})).toBe('(inga angivna)');
	});
});

describe('formatNote', () => {
	it('gives nothing for a missing or blank note, so the catalog line gets no empty column', () => {
		expect(formatNote(undefined)).toBe('');
		expect(formatNote(' \n ')).toBe('');
		const ex = { id: 'ex_a', name: 'A', type: 'time' as const, instruction: '', note: '  ', log: [] };
		expect(formatCatalog([ex])).toBe('ex_a | A | time');
	});

	it('cuts at the limit, trims a space before the ellipsis, and never splits an emoji', () => {
		const exact = 'x'.repeat(CATALOG_NOTE_MAX);
		expect(formatNote(exact, CATALOG_NOTE_MAX)).toBe(exact);
		expect(formatNote(`${exact}y`, CATALOG_NOTE_MAX)).toBe(`${'x'.repeat(CATALOG_NOTE_MAX - 1)}…`);
		expect(formatNote('abc def', 5)).toBe('abc…');
		expect(formatNote('ab😀😀😀', 4)).toBe('ab😀…');
	});

	it('keeps the note in its own column', () => {
		expect(formatNote('tung | lätt')).toBe('tung / lätt');
	});
});

describe('tools', () => {
	it('propose_exercise creates a new exercise, reuses an existing one and updates the live list', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };

		const created = await executeTool(storage, state, 'propose_exercise', newExercise, TODAY);
		expect(created).toMatchObject({ isError: false, event: 'Lade till Hantelrodd: 3 set × 10 reps (ny övning)' });
		expect((await getExercise(storage, 'ex_hantelrodd'))!.data).toMatchObject({ type: 'weight' });

		// The same name again updates the set instead of creating a duplicate.
		const again = await executeTool(storage, state, 'propose_exercise', { ...newExercise, name: 'hantelrodd', sets: 4 }, TODAY);
		expect(again.event).toBe('Uppdaterade Hantelrodd: 4 set × 10 reps');

		await executeTool(storage, state, 'propose_exercise', { ...newExercise, existingId: 'ex_plankan', name: null, target: { reps: null, seconds: 45 } }, TODAY);
		expect(state.draft).toEqual([
			{ exerciseId: 'ex_hantelrodd', sets: 4, target: { reps: 10 } },
			{ exerciseId: 'ex_plankan', sets: 3, target: { seconds: 45 } }
		]);
		expect((await storage.list('exercises/')).length).toBe(3);
	});

	it('propose_exercise returns errors the model can correct', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };
		const bad = async (input: unknown) => (await executeTool(storage, state, 'propose_exercise', input, TODAY)).content;
		expect(await bad({ ...newExercise, existingId: 'ex_finns_inte' })).toMatch(/ingen övning med id/);
		expect(await bad({ ...newExercise, existingId: 'ex_plankan' })).toMatch(/seconds/);
		expect(await bad({ ...newExercise, target: { reps: 8, seconds: 30 } })).toMatch(/antingen reps eller seconds/);
		expect(state.draft).toEqual([]);
	});

	it('set_workout saves a new workout as v1 and then the next version', async () => {
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

	it('set_workout never overwrites another workout with the same name', async () => {
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

	it('set_workout rejects unknown exercises and wrong target type', async () => {
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

describe('a turn', () => {
	it('runs tools, sends back the results and logs for the user', async () => {
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
			{ role: 'workout', text: 'Passet: 1 övning', items: [{ exerciseId: 'ex_hantelrodd', sets: 3, target: { reps: 10 } }] },
			{ role: 'assistant', text: 'Klart. Något mer?' }
		]);
		// The second call contains the whole first response unchanged (incl. the thinking block) and the tool result.
		const second = calls[1].messages;
		expect(second[1]).toEqual({ role: 'assistant', content: [thinking, text('Bra val, jag lägger till hantelrodd.'), toolUse('t1', 'propose_exercise', newExercise)] });
		expect(second[2].content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 't1' })]);
		// The system prompt is the same in both calls.
		expect(calls[0].system).toEqual(calls[1].system);
		expect(JSON.stringify(calls[0].system)).toContain('Mål:\\n- Styrka');
	});

	it('logs API errors but keeps what already happened', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		const { create } = scripted(message([toolUse('t1', 'propose_exercise', newExercise)], 'tool_use'));
		await expect(
			runTurn(storage, conversation, 'Lägg till hantelrodd', { model: 'm', today: TODAY, createMessage: create })
		).rejects.toThrow();
		expect(conversation.draft).toHaveLength(1);
		expect(conversation.log.at(-1)).toMatchObject({ role: 'error' });
	});

	it('never runs a truncated tool call', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		const { create } = scripted(message([toolUse('t1', 'propose_exercise', { existingId: null })], 'max_tokens'));
		await runTurn(storage, conversation, 'x', { model: 'm', today: TODAY, createMessage: create });
		expect(conversation.draft).toEqual([]);
		expect(conversation.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', is_error: true }] });
	});

	it('editing starts with the workout exercises in the live list', async () => {
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

	it('requests fallback only for models that support it', async () => {
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

describe('storage error in a tool call', () => {
	/** Storage that throws when an exercise is written, e.g. a network error against Blob. */
	class FailingWrites extends MemoryUserStorage {
		failing = true;
		override async writeJson(path: string, data: unknown, options?: Parameters<MemoryUserStorage['writeJson']>[2]) {
			if (this.failing && path.startsWith('exercises/')) throw new Error('nätverksfel');
			return super.writeJson(path, data, options);
		}
	}

	it('returns an error result to the model so the conversation stays valid', async () => {
		const storage = new FailingWrites('u1');
		const conversation = await startConversation(storage, null);
		const { create, calls } = scripted(
			message([toolUse('t1', 'propose_exercise', newExercise)], 'tool_use'),
			message([text('Det gick inte att spara just nu.')], 'end_turn'),
			message([text('Nu gick det.')], 'end_turn')
		);

		await runTurn(storage, conversation, 'Lägg till hantelrodd', { model: 'm', today: TODAY, createMessage: create });

		// Every tool_use is followed by a tool_result, so the next call is valid.
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

describe('tool schemas', () => {
	/** Walks all subschemas of a JSON schema. */
	function* nodes(schema: unknown): Generator<Record<string, unknown>> {
		if (Array.isArray(schema)) for (const s of schema) yield* nodes(s);
		else if (schema && typeof schema === 'object') {
			yield schema as Record<string, unknown>;
			for (const v of Object.values(schema)) yield* nodes(v);
		}
	}

	it('never combines enum with a type array (rejected by the API for strict tools)', async () => {
		const { BUILDER_TOOLS } = await import('./tools');
		const { SWAP_TOOL } = await import('../helper/swap');
		for (const tool of [...BUILDER_TOOLS, SWAP_TOOL]) {
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

describe('saving a turn', () => {
	it('saves when only the stored version differs, and refuses when another turn was saved', async () => {
		const storage = new MemoryUserStorage('u1');
		const conversation = await startConversation(storage, null);
		await saveConversation(storage, conversation);
		const loaded = (await loadConversation(storage, conversation.id))!;
		// The same content written again: a new version, but no new turn.
		await saveConversation(storage, loaded.conversation, loaded.version);

		const mine = structuredClone(loaded.conversation);
		mine.messages.push({ role: 'user', content: 'Hej' });
		await saveTurn(storage, mine, loaded.version, { messages: 0, log: 0 });
		expect((await loadConversation(storage, conversation.id))!.conversation.messages).toHaveLength(1);

		const stale = structuredClone(loaded.conversation);
		stale.messages.push({ role: 'user', content: 'Från en annan flik' });
		await expect(saveTurn(storage, stale, loaded.version, { messages: 0, log: 0 })).rejects.toBeInstanceOf(StorageConflictError);
	});

	it('refuses when the list was reordered in another tab while the turn ran', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		conversation.draft = [
			{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } },
			{ exerciseId: 'ex_plankan', sets: 3, target: { seconds: 40 } }
		];
		await saveConversation(storage, conversation);
		const loaded = (await loadConversation(storage, conversation.id))!;
		const base = { messages: loaded.conversation.messages.length, log: loaded.conversation.log.length };

		// The other tab: a reorder adds to the log, not to the messages.
		const other = structuredClone(loaded.conversation);
		reorderDraft(other, ['ex_plankan', 'ex_marklyft'], new Map());
		await saveConversation(storage, other, loaded.version);

		const mine = structuredClone(loaded.conversation);
		mine.messages.push({ role: 'user', content: 'Hej' });
		await expect(saveTurn(storage, mine, loaded.version, base)).rejects.toBeInstanceOf(StorageConflictError);
		expect((await loadConversation(storage, conversation.id))!.conversation.draft[0].exerciseId).toBe('ex_plankan');
	});

	it('never retries creating a conversation, nor one that is gone', async () => {
		const storage = new MemoryUserStorage('u1');
		const conversation = await startConversation(storage, null);
		await saveConversation(storage, conversation);
		await expect(saveTurn(storage, conversation, undefined, { messages: 0, log: 0 })).rejects.toBeInstanceOf(StorageConflictError);
		const gone = { ...conversation, id: 'b_finnsinte1' };
		await expect(saveTurn(storage, gone, 'v-gammal', { messages: 0, log: 0 })).rejects.toBeInstanceOf(StorageConflictError);
	});
});

describe('warm-up and stretch in the builder (#100)', () => {
	it('set_workout requires a phase per exercise with a plain enum', async () => {
		const { BUILDER_TOOLS } = await import('./tools');
		const setWorkout = BUILDER_TOOLS.find((t) => t.name === 'set_workout')!;
		const item = (setWorkout.input_schema.properties as Record<string, { items: { properties: Record<string, unknown>; required: string[] } }>).exercises.items;
		expect(item.properties.phase).toMatchObject({ type: 'string', enum: ['warmup', 'main', 'cooldown'] });
		expect(item.required).toContain('phase');
		const propose = BUILDER_TOOLS.find((t) => t.name === 'propose_exercise')!;
		expect((propose.input_schema.required as string[]) ?? []).toContain('phase');
	});

	it('the prompt asks about a warm-up and a stretch matched to the trained muscles', () => {
		const prompt = buildSystemPrompt({}, [], null);
		expect(prompt).toMatch(/ta med en kort uppvärmning och stretch i ett nytt pass och nämn att de går att ta bort/);
		expect(prompt).toMatch(/specifik för de muskler passet har tränat/);
		expect(prompt).toMatch(/phase warmup/);
	});

	it('shows the phases of the workout being edited', () => {
		const prompt = buildSystemPrompt({}, [], {
			slug: 'pass-c',
			name: 'Pass C',
			version: 1,
			createdAt: TODAY,
			exercises: [
				{ exerciseId: 'ex_plankan', sets: 1, target: { seconds: 30 }, phase: 'warmup' },
				{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 5 } }
			]
		});
		expect(prompt).toContain('1. ex_plankan (ex_plankan): 1 set × 30 s, uppvärmning');
		expect(prompt).toContain('2. ex_marklyft (ex_marklyft): 3 set × 5 reps\n');
	});

	it('set_workout saves phases in order and refuses weights in a warm-up or stretch', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };
		const plank = { exerciseId: 'ex_plankan', sets: 1, target: { reps: null, seconds: 30 } };
		const deadlift = { exerciseId: 'ex_marklyft', sets: 3, target: { reps: 5, seconds: null } };

		const refused = await executeTool(
			storage,
			state,
			'set_workout',
			{ name: 'Pass C', changeNote: '', exercises: [{ ...deadlift, phase: 'warmup' }] },
			TODAY
		);
		expect(refused).toMatchObject({ isError: true });
		expect(refused.content).toMatch(/viktövning/);
		expect(await listLatestWorkouts(storage)).toEqual([]);

		const bad = await executeTool(storage, state, 'set_workout', { name: 'Pass C', changeNote: '', exercises: [{ ...deadlift, phase: 'stretch' }] }, TODAY);
		expect(bad.content).toMatch(/phase måste vara/);

		// The stretch is given first but saved last; main stays without a phase field.
		const saved = await executeTool(
			storage,
			state,
			'set_workout',
			{ name: 'Pass C', changeNote: '', exercises: [{ ...plank, phase: 'cooldown' }, { ...deadlift, phase: 'main' }] },
			TODAY
		);
		expect(saved.isError).toBe(false);
		expect((await listLatestWorkouts(storage))[0].exercises).toEqual([
			{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 5 } },
			{ exerciseId: 'ex_plankan', sets: 1, target: { seconds: 30 }, phase: 'cooldown' }
		]);
	});

	it('propose_exercise puts the phase in the live list', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };
		const out = await executeTool(
			storage,
			state,
			'propose_exercise',
			{ ...newExercise, existingId: 'ex_plankan', name: null, sets: 1, target: { reps: null, seconds: 30 }, phase: 'warmup' },
			TODAY
		);
		expect(out.event).toBe('Lade till Plankan: 1 set × 30 s (uppvärmning)');
		expect(state.draft).toEqual([{ exerciseId: 'ex_plankan', sets: 1, target: { seconds: 30 }, phase: 'warmup' }]);
		// A main exercise proposed later still comes after the warm-up in the live list, and a new warm-up goes before it.
		await executeTool(storage, state, 'propose_exercise', { ...newExercise, existingId: 'ex_marklyft', name: null, phase: 'main' }, TODAY);
		await executeTool(storage, state, 'propose_exercise', { ...newExercise, name: 'Höftcirklar', type: 'bodyweight', phase: 'warmup' }, TODAY);
		expect(state.draft.map((d) => [d.exerciseId, d.phase])).toEqual([
			['ex_plankan', 'warmup'],
			['ex_hoftcirklar', 'warmup'],
			['ex_marklyft', undefined]
		]);
		expect((await executeTool(storage, state, 'propose_exercise', { ...newExercise, phase: 'cooldown' }, TODAY)).content).toMatch(/viktövning/);
	});
});

describe('a whole workout at once', () => {
	const marklyft = { ...newExercise, existingId: 'ex_marklyft', name: null, type: null, instruction: null, replacesId: null };
	const plankan = { ...marklyft, existingId: 'ex_plankan', target: { reps: null, seconds: 40 } };

	it('asks Milon to propose the whole workout and to swap in place', () => {
		const prompt = buildSystemPrompt({}, [], null);
		expect(prompt).toMatch(/Föreslå ett helt pass på en gång/);
		expect(prompt).toMatch(/replacesId/);
		expect(prompt).toMatch(/remove_exercise/);
	});

	it('propose_exercise with replacesId puts the new exercise in the old one\'s place', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };
		await executeTool(storage, state, 'propose_exercise', marklyft, TODAY);
		await executeTool(storage, state, 'propose_exercise', plankan, TODAY);
		const swap = await executeTool(storage, state, 'propose_exercise', { ...newExercise, replacesId: 'ex_marklyft' }, TODAY);
		expect(swap).toMatchObject({ isError: false, changedDraft: true, event: 'Bytte Marklyft mot Hantelrodd: 3 set × 10 reps (ny övning)' });
		expect(state.draft.map((d) => d.exerciseId)).toEqual(['ex_hantelrodd', 'ex_plankan']);

		// Swapping in an exercise already in the list moves it there instead of listing it twice.
		await executeTool(storage, state, 'propose_exercise', { ...plankan, replacesId: 'ex_hantelrodd' }, TODAY);
		expect(state.draft.map((d) => d.exerciseId)).toEqual(['ex_plankan']);

		const missing = await executeTool(storage, state, 'propose_exercise', { ...marklyft, replacesId: 'ex_finns_inte' }, TODAY);
		expect(missing).toMatchObject({ isError: true });
		expect(state.draft.map((d) => d.exerciseId)).toEqual(['ex_plankan']);

		// A failed swap with a new exercise leaves nothing behind in the catalog.
		const before = (await storage.list('exercises/')).length;
		const failed = await executeTool(storage, state, 'propose_exercise', { ...newExercise, name: 'Kettlebellsving', replacesId: 'ex_finns_inte' }, TODAY);
		expect(failed).toMatchObject({ isError: true });
		expect((await storage.list('exercises/')).length).toBe(before);
	});

	it('remove_exercise takes an exercise out of the list, but not out of the catalog', async () => {
		const storage = await setup();
		const state: BuilderState = { editingSlug: null, draft: [] };
		await executeTool(storage, state, 'propose_exercise', marklyft, TODAY);
		expect(await executeTool(storage, state, 'remove_exercise', { exerciseId: 'ex_marklyft' }, TODAY)).toMatchObject({
			isError: false,
			changedDraft: true,
			event: 'Tog bort Marklyft'
		});
		expect(state.draft).toEqual([]);
		expect(await getExercise(storage, 'ex_marklyft')).not.toBeNull();
		expect(await executeTool(storage, state, 'remove_exercise', { exerciseId: 'ex_marklyft' }, TODAY)).toMatchObject({ isError: true });
	});

	it('a turn that proposes several exercises shows one card where the list first changed', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		const { create } = scripted(
			message([toolUse('t1', 'propose_exercise', marklyft), toolUse('t2', 'propose_exercise', plankan)], 'tool_use'),
			message([text('Här är passet.')], 'end_turn')
		);
		await runTurn(storage, conversation, 'Ben, 30 min', { model: 'claude-sonnet-5-5', today: TODAY, createMessage: create });
		expect(conversation.log.map((l) => l.role)).toEqual(['user', 'workout', 'assistant']);
		expect(conversation.log[1].items?.map((d) => d.exerciseId)).toEqual(['ex_marklyft', 'ex_plankan']);

		const view = await conversationView(storage, conversation);
		expect(view.log[1]).toMatchObject({ role: 'workout', items: [{ name: 'Marklyft' }, { name: 'Plankan' }] });
	});

	it('a swap or removal also says what went, and a turn that empties the list shows no card', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		conversation.draft = [{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }];
		const swap = scripted(message([toolUse('t1', 'propose_exercise', { ...plankan, replacesId: 'ex_marklyft' })], 'tool_use'), message([text('Bytt.')], 'end_turn'));
		await runTurn(storage, conversation, 'Byt ut Marklyft.', { model: 'claude-sonnet-5-5', today: TODAY, createMessage: swap.create });
		expect(conversation.log.slice(1).map((l) => [l.role, l.text])).toEqual([
			['workout', 'Passet: 1 övning'],
			['event', 'Bytte Marklyft mot Plankan: 3 set × 40 s'],
			['assistant', 'Bytt.']
		]);

		const remove = scripted(message([toolUse('t2', 'remove_exercise', { exerciseId: 'ex_plankan' })], 'tool_use'), message([text('Borta.')], 'end_turn'));
		await runTurn(storage, conversation, 'Ta bort plankan.', { model: 'claude-sonnet-5-5', today: TODAY, createMessage: remove.create });
		expect(conversation.log.slice(4).map((l) => [l.role, l.text])).toEqual([
			['user', 'Ta bort plankan.'],
			['event', 'Tog bort Plankan'],
			['assistant', 'Borta.']
		]);
	});

	it('the card is shown even when the turn fails after changing the list', async () => {
		const storage = await setup();
		const conversation = await startConversation(storage, null);
		const { create } = scripted(message([toolUse('t1', 'propose_exercise', marklyft)], 'tool_use'));
		await expect(runTurn(storage, conversation, 'Ben', { model: 'claude-sonnet-5-5', today: TODAY, createMessage: create })).rejects.toThrow();
		expect(conversation.log.map((l) => l.role)).toEqual(['user', 'workout', 'error']);
	});
});

describe("the user's own order", () => {
	async function withList() {
		const storage = await setup();
		await createExercise(storage, { name: 'Jumping jacks', type: 'bodyweight', instruction: '' });
		const conversation = await startConversation(storage, null);
		conversation.draft = [
			{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 20 }, phase: 'warmup' },
			{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } },
			{ exerciseId: 'ex_plankan', sets: 3, target: { seconds: 40 } }
		];
		const names = new Map([
			['ex_marklyft', 'Marklyft'],
			['ex_plankan', 'Plankan'],
			['ex_jumping_jacks', 'Jumping jacks']
		]);
		return { storage, conversation, names };
	}

	it('refuses an order that is not the same exercises, or that splits the parts', async () => {
		const { conversation, names } = await withList();
		expect(reorderDraft(conversation, ['ex_marklyft', 'ex_plankan'], names)).toMatch(/stämmer inte/);
		expect(reorderDraft(conversation, ['ex_marklyft', 'ex_plankan', 'ex_okand'], names)).toMatch(/stämmer inte/);
		expect(reorderDraft(conversation, ['ex_marklyft', 'ex_marklyft', 'ex_plankan'], names)).toMatch(/stämmer inte/);
		expect(reorderDraft(conversation, 'ex_marklyft', names)).toMatch(/stämmer inte/);
		expect(reorderDraft(conversation, ['ex_marklyft', 'ex_jumping_jacks', 'ex_plankan'], names)).toMatch(/Uppvärmningen ska vara först/);
		expect(conversation.draft.map((d) => d.exerciseId)).toEqual(['ex_jumping_jacks', 'ex_marklyft', 'ex_plankan']);
		expect(conversation.pendingNote).toBeUndefined();
	});

	it('tells Milon with the next message, and a save in that turn keeps the order', async () => {
		const { storage, conversation, names } = await withList();
		expect(reorderDraft(conversation, ['ex_jumping_jacks', 'ex_plankan', 'ex_marklyft'], names)).toBeNull();
		expect(conversation.log).toEqual([{ role: 'event', text: 'Du ändrade ordningen' }]);

		// Milon saves in its own order; the user's wins.
		const save = {
			name: 'Pass X',
			changeNote: 'Nytt',
			exercises: [
				{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 20, seconds: null }, phase: 'warmup' },
				{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8, seconds: null }, phase: 'main' },
				{ exerciseId: 'ex_plankan', sets: 3, target: { reps: null, seconds: 40 }, phase: 'main' }
			]
		};
		const { create, calls } = scripted(message([toolUse('t1', 'set_workout', save)], 'tool_use'), message([text('Sparat.')], 'end_turn'));
		await runTurn(storage, conversation, 'Spara passet.', { model: 'claude-sonnet-5-5', today: TODAY, createMessage: create });

		const sent = calls[0].messages.at(-1)!.content as string;
		expect(sent).toMatch(/^\(Användaren har själv ändrat ordningen i passet\. Den är nu:\n1\. Jumping jacks \(ex_jumping_jacks\)\n2\. Plankan/);
		expect(sent).toMatch(/\n\nSpara passet\.$/);
		// The note is for Milon only; the chat shows what the user wrote.
		expect(conversation.log.find((l) => l.role === 'user')).toEqual({ role: 'user', text: 'Spara passet.' });
		const saved = (await listLatestWorkouts(storage))[0];
		expect(saved.exercises.map((e) => e.exerciseId)).toEqual(['ex_jumping_jacks', 'ex_plankan', 'ex_marklyft']);
		expect(conversation.pendingNote).toBeUndefined();
		expect(conversation.userOrder).toBeUndefined();
	});

	it("after that turn, Milon's own order is saved again", async () => {
		const storage = await setup();
		const state: BuilderState = {
			editingSlug: null,
			draft: [
				{ exerciseId: 'ex_plankan', sets: 3, target: { seconds: 40 } },
				{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } }
			]
		};
		const save = {
			name: 'Pass Y',
			changeNote: '',
			exercises: [
				{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8, seconds: null }, phase: 'main' },
				{ exerciseId: 'ex_plankan', sets: 3, target: { reps: null, seconds: 40 }, phase: 'main' }
			]
		};
		await executeTool(storage, state, 'set_workout', save, TODAY);
		expect(state.draft.map((d) => d.exerciseId)).toEqual(['ex_marklyft', 'ex_plankan']);
	});
});
