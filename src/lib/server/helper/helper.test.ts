import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../../model';
import { applySwap, type ExerciseInfo } from '../../session/active';
import type { CreateMessage } from '../ai/models';
import { createExercise, getExercise, prependLogEntry, saveWorkoutVersion } from '../data';
import { MemoryUserStorage } from '../storage/memory';
import { askHelper, parseHelperInput } from './ask';
import { buildHelperPrompt } from './prompt';

async function setup() {
	const storage = new MemoryUserStorage('u1');
	await createExercise(storage, { name: 'Hantelpress', type: 'weight', instruction: '' });
	await createExercise(storage, { name: 'Axelpress', type: 'weight', instruction: '' });
	await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
	for (let d = 1; d <= 7; d++) {
		await prependLogEntry(storage, 'ex_hantelpress', { date: `2026-09-0${d}`, sets: [{ weight: 10 + d, reps: 8 }] });
	}
	await saveWorkoutVersion(storage, {
		slug: 'pass-b',
		name: 'Pass B',
		createdAt: '2026-09-01',
		exercises: [
			{ exerciseId: 'ex_hantelpress', sets: 3, target: { reps: 10 } },
			{ exerciseId: 'ex_plankan', sets: 2, target: { seconds: 45 } }
		]
	});
	return storage;
}

function session(): ActiveSession {
	return {
		sessionId: 's_20261006',
		workoutSlug: 'pass-b',
		workoutVersion: 1,
		startedAt: '2026-10-06T17:10:00+02:00',
		lastActivityAt: '2026-10-06T17:20:00+02:00',
		exercises: [
			{
				exerciseId: 'ex_hantelpress',
				sets: [
					{ weight: 17.5, reps: 8, done: true },
					{ weight: 17.5, reps: 8, done: false }
				]
			},
			{ exerciseId: 'ex_plankan', sets: [{ seconds: 45, done: false }] }
		],
		deviations: []
	};
}

const reply = (content: unknown[], stop: string) =>
	({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content, stop_reason: stop }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => ({ type: 'text', text: t });
const swapCall = (input: unknown) => ({ type: 'tool_use', id: 'tu1', name: 'swap_exercise', input });

function scripted(...responses: Anthropic.Beta.BetaMessage[]) {
	const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
	const create: CreateMessage = async (params) => {
		calls.push(structuredClone(params));
		return responses.shift()!;
	};
	return { create, calls };
}

const input = (question: string, history: { role: 'user' | 'assistant'; text: string }[] = []) =>
	parseHelperInput({ session: session(), exerciseId: 'ex_hantelpress', history, question });

describe('helper', () => {
	it('answers about the whole workout when no exercise is given', async () => {
		const storage = await setup();
		const { create, calls } = scripted(reply([text('Kör hantelpressen först.')], 'end_turn'));
		const whole = parseHelperInput({ session: { ...session(), preparing: true }, question: 'Vilken ordning?' });
		const result = await askHelper(storage, whole, { model: 'claude-haiku-4-5', createMessage: create });
		expect(result.reply).toBe('Kör hantelpressen först.');
		const system = calls[0].system as string;
		expect(system).toContain('frågan gäller hela passet, ingen enskild övning');
		expect(system).toContain('- Hantelpress (ex_hantelpress, weight)');
		expect(system).not.toContain('(okänd övning)');
	});

	it('sends small context: workout name, the sets so far, five latest log entries and the catalog', async () => {
		const storage = await setup();
		const { create, calls } = scripted(reply([text('Sänk vikten lite.')], 'end_turn'));
		const result = await askHelper(storage, input('Är 17,5 för tungt?'), { model: 'claude-haiku-4-5', createMessage: create });
		expect(result).toEqual({ reply: 'Sänk vikten lite.', swap: null });

		const params = calls[0];
		const system = params.system as string;
		expect(system).toContain('Pass: Pass B');
		expect(system).toContain('- Hantelpress (ex_hantelpress, weight): 17,5 kg × 8 klart, 17,5 kg × 8');
		expect(system).toContain('- Plankan (ex_plankan, time): 45 s');
		expect(system).toContain('- 2026-09-07: 17 kg × 8');
		expect(system).toContain('- 2026-09-03: 13 kg × 8');
		expect(system).not.toContain('2026-09-02'); // only the five latest
		expect(system).toContain('ex_axelpress | Axelpress | weight');
		expect(system).toContain('ge direkt två konkreta alternativ i första svaret, utan motfrågor');
		expect(system).toContain('Föreslå aldrig en katalogövning som tränar en annan muskelgrupp');
		expect(system).toContain('Skriv ren text utan markdown');
		expect(params.messages).toEqual([{ role: 'user', content: 'Är 17,5 för tungt?' }]);
		// Helper model: no thinking, effort or fallback parameters.
		expect(params).not.toHaveProperty('thinking');
		expect(params).not.toHaveProperty('fallbacks');
	});

	it('tells Milon whether the workout is under way or only being prepared', async () => {
		const storage = await setup();
		const { create, calls } = scripted(reply([text('Ok.')], 'end_turn'), reply([text('Ok.')], 'end_turn'));
		await askHelper(storage, input('Hur tung?'), { model: 'claude-haiku-4-5', createMessage: create });
		const preparing = parseHelperInput({ session: { ...session(), preparing: true }, exerciseId: 'ex_hantelpress', history: [], question: 'Byta?' });
		await askHelper(storage, preparing, { model: 'claude-haiku-4-5', createMessage: create });
		expect(calls[0].system).toContain('Användaren tränar just nu');
		expect(calls[1].system).toContain('Användaren förbereder passet och har inte börjat än');
		expect(calls[1].system).not.toContain('{{');
	});

	it('includes earlier questions and answers in the panel', async () => {
		const storage = await setup();
		const { create, calls } = scripted(reply([text('Ok.')], 'end_turn'));
		await askHelper(
			storage,
			input('Axelpress', [
				{ role: 'user', text: 'Jag vill byta' },
				{ role: 'assistant', text: 'Axelpress eller armhävningar?' }
			]),
			{ model: 'claude-haiku-4-5', createMessage: create }
		);
		expect(calls[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
	});

	it('swaps to an existing exercise', async () => {
		const storage = await setup();
		const { create } = scripted(
			reply([text('Då tar vi axelpress.'), swapCall({ fromExerciseId: 'ex_hantelpress', toExerciseId: 'ex_axelpress', newExercise: null })], 'tool_use')
		);
		const result = await askHelper(storage, input('Axelpress'), { model: 'claude-haiku-4-5', createMessage: create });
		expect(result.reply).toBe('Då tar vi axelpress.');
		expect(result.swap).toMatchObject({ from: 'ex_hantelpress', to: { id: 'ex_axelpress', type: 'weight' }, created: false });
	});

	it('creates a new exercise when none in the catalog fits', async () => {
		const storage = await setup();
		const { create } = scripted(
			reply(
				[
					swapCall({
						fromExerciseId: 'ex_plankan',
						toExerciseId: null,
						newExercise: { name: 'Sidoplanka', type: 'time', instruction: 'Armbåge under axeln.' }
					})
				],
				'tool_use'
			)
		);
		const result = await askHelper(storage, input('Sidoplanka'), { model: 'claude-haiku-4-5', createMessage: create });
		expect(result).toMatchObject({ reply: 'Bytt Plankan mot Sidoplanka.', swap: { from: 'ex_plankan', created: true, to: { id: 'ex_sidoplanka' } } });
		expect((await getExercise(storage, 'ex_sidoplanka'))!.data.instruction).toBe('Armbåge under axeln.');
	});

	it('lets the model correct an invalid swap once, then gives up', async () => {
		const storage = await setup();
		const bad = swapCall({ fromExerciseId: 'ex_hantelpress', toExerciseId: 'ex_plankan', newExercise: null });
		const { create, calls } = scripted(reply([bad], 'tool_use'), reply([bad], 'tool_use'));
		const result = await askHelper(storage, input('Plankan'), { model: 'claude-haiku-4-5', createMessage: create });
		expect(result.swap).toBeNull();
		expect(calls).toHaveLength(2);
		expect(calls[1].messages.at(-1)).toMatchObject({
			role: 'user',
			content: [{ type: 'tool_result', is_error: true, content: 'Plankan finns redan i passet.' }]
		});
	});

	it('never runs a truncated swap', async () => {
		const storage = await setup();
		const { create } = scripted(reply([swapCall({ fromExerciseId: 'ex_hantelpress' })], 'max_tokens'));
		const result = await askHelper(storage, input('Byt'), { model: 'claude-haiku-4-5', createMessage: create });
		expect(result.swap).toBeNull();
	});

	it('rejects malformed input', () => {
		expect(() => parseHelperInput({ session: session(), exerciseId: 'ex_okand', question: 'x' })).toThrow(/exerciseId/);
		expect(parseHelperInput({ session: session(), question: 'x' }).exerciseId).toBe('');
		expect(() => parseHelperInput({ session: session(), exerciseId: 123, question: 'x' })).toThrow(/exerciseId/);
		expect(() => parseHelperInput({ session: session(), exerciseId: 'ex_plankan', question: '' })).toThrow(/tom/);
		expect(() =>
			parseHelperInput({ session: session(), exerciseId: 'ex_plankan', question: 'x', history: [{ role: 'assistant', text: 'hej' }] })
		).toThrow(/history/);
	});
});

describe('buildHelperPrompt', () => {
	it('says the exercise is unknown when it is missing, not that the question is about the whole workout', () => {
		const system = buildHelperPrompt('Pass B', session(), new Map(), null, []);
		expect(system).toContain('(okänd övning)');
		expect(system).not.toContain('hela passet');
	});
});

describe('swap in the session', () => {
	const axelpress: ExerciseInfo = {
		id: 'ex_axelpress',
		name: 'Axelpress',
		type: 'weight',
		instruction: '',
		lastEntry: { date: '2026-09-01', sets: [{ weight: 12.5, reps: 10 }] }
	};
	const armhavning: ExerciseInfo = { id: 'ex_armhavning', name: 'Armhävning', type: 'bodyweight', instruction: '' };
	const sidoplanka: ExerciseInfo = { id: 'ex_sidoplanka', name: 'Sidoplanka', type: 'time', instruction: '' };

	it('replaces an exercise without completed sets and prefills from last time', () => {
		const s = session();
		applySwap(s, 'ex_plankan', sidoplanka, { seconds: 45 });
		expect(s.exercises[1]).toEqual({ exerciseId: 'ex_sidoplanka', sets: [{ seconds: 45, done: false }] });
		expect(s.deviations).toEqual([{ type: 'swap', from: 'ex_plankan', to: 'ex_sidoplanka' }]);
	});

	it('keeps completed sets and adds the new exercise after', () => {
		const s = session();
		applySwap(s, 'ex_hantelpress', axelpress, { reps: 10 });
		expect(s.exercises.map((e) => e.exerciseId)).toEqual(['ex_hantelpress', 'ex_axelpress', 'ex_plankan']);
		expect(s.exercises[0].sets).toEqual([{ weight: 17.5, reps: 8, done: true }]);
		expect(s.exercises[1].sets).toEqual([
			{ weight: 12.5, reps: 10, done: false },
			{ weight: 12.5, reps: 10, done: false }
		]);
	});

	it('merges chained swaps and removes the deviation when swapping back', () => {
		const s = session();
		applySwap(s, 'ex_plankan', sidoplanka);
		applySwap(s, 'ex_sidoplanka', armhavning, { reps: 10 });
		expect(s.deviations).toEqual([{ type: 'swap', from: 'ex_plankan', to: 'ex_armhavning' }]);
		applySwap(s, 'ex_armhavning', { id: 'ex_plankan', name: 'Plankan', type: 'time', instruction: '' }, { seconds: 45 });
		expect(s.deviations).toEqual([]);
		expect(s.exercises[1].exerciseId).toBe('ex_plankan');
	});

	it('does nothing if the new exercise is already in the session', () => {
		const s = session();
		applySwap(s, 'ex_hantelpress', { id: 'ex_plankan', name: 'Plankan', type: 'time', instruction: '' });
		expect(s).toEqual(session());
	});
});
