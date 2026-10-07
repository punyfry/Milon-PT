import type Anthropic from '@anthropic-ai/sdk';
import { ValidationError, isObject, type ActiveSession, type Exercise } from '../../model';
import type { ExerciseInfo } from '../../session/active';
import { modelOptions, type CreateMessage } from '../ai/models';
import { checkActiveSession } from '../data/save-session';
import { listExercises } from '../data/exercises';
import { getWorkout } from '../data/workouts';
import type { UserStorage } from '../storage/types';
import { buildHelperPrompt } from './prompt';
import { SWAP_TOOL, executeSwap } from './swap';

export interface HelperTurn {
	role: 'user' | 'assistant';
	text: string;
}

export interface HelperInput {
	session: ActiveSession;
	exerciseId: string;
	/** Earlier questions and answers in this helper panel, as text. */
	history: HelperTurn[];
	question: string;
}

export interface HelperResult {
	reply: string;
	swap: { from: string; to: ExerciseInfo; created: boolean } | null;
}

const MAX_QUESTION = 500;
const MAX_TURN = 1500;
const MAX_HISTORY = 12;

export function parseHelperInput(raw: unknown): HelperInput {
	const issues: string[] = [];
	if (!isObject(raw)) throw new ValidationError('fråga', ['Ogiltig JSON']);
	const session = checkActiveSession(raw.session, issues);
	const exerciseId = typeof raw.exerciseId === 'string' ? raw.exerciseId : '';
	if (session && Array.isArray(session.exercises) && !session.exercises.some((e) => e.exerciseId === exerciseId))
		issues.push('exerciseId finns inte i passet');
	const question = typeof raw.question === 'string' ? raw.question.trim() : '';
	if (!question) issues.push('Frågan är tom');
	if (question.length > MAX_QUESTION) issues.push(`Frågan är för lång (max ${MAX_QUESTION} tecken)`);
	const history: HelperTurn[] = [];
	if (raw.history !== undefined) {
		if (!Array.isArray(raw.history) || raw.history.length > MAX_HISTORY) issues.push('history är ogiltig');
		else
			raw.history.forEach((t, i) => {
				const role = i % 2 === 0 ? 'user' : 'assistant';
				if (!isObject(t) || t.role !== role || typeof t.text !== 'string' || !t.text.trim() || t.text.length > MAX_TURN)
					issues.push(`history[${i}] är ogiltig`);
				else history.push({ role, text: t.text });
			});
		if (history.length % 2 !== 0) issues.push('history måste sluta med ett svar');
	}
	if (issues.length || !session) throw new ValidationError('fråga', issues);
	return { session, exerciseId, history, question };
}

/**
 * One helper call. The context is kept small: workout name, today's sets, the
 * five latest log entries for the exercise, the catalog and the question.
 * Nothing is sent unless the user asked.
 */
export async function askHelper(
	storage: UserStorage,
	input: HelperInput,
	options: { model: string; createMessage: CreateMessage }
): Promise<HelperResult> {
	const { session } = input;
	const [workout, all] = await Promise.all([
		getWorkout(storage, session.workoutSlug, session.workoutVersion),
		listExercises(storage)
	]);
	const byId = new Map<string, Exercise>(all.map((e) => [e.data.id, e.data]));
	const catalog = all.map((e) => e.data).filter((e) => !e.archived);
	const system = buildHelperPrompt(
		workout?.data.name ?? session.workoutSlug,
		session,
		byId,
		byId.get(input.exerciseId),
		catalog
	);

	const messages: Anthropic.Beta.BetaMessageParam[] = [
		...input.history.map((t) => ({ role: t.role, content: t.text })),
		{ role: 'user', content: input.question }
	];

	// At most one retry if the swap is rejected, so the model can correct itself.
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await options.createMessage({
			model: options.model,
			max_tokens: 1024,
			system,
			tools: [SWAP_TOOL],
			messages,
			...modelOptions(options.model, 'low')
		});
		const text = response.content
			.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
			.map((b) => b.text.trim())
			.filter(Boolean)
			.join('\n\n');

		if (response.stop_reason === 'refusal') return { reply: 'Milon kan inte hjälpa till med det.', swap: null };
		const call = response.content.find(
			(b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'swap_exercise'
		);
		// A truncated tool call is never run.
		if (!call || response.stop_reason === 'max_tokens') {
			return { reply: text || 'Milon har inget svar just nu. Försök igen.', swap: null };
		}

		const outcome = await executeSwap(storage, session, catalog, call.input);
		if (outcome.ok) {
			const fromName = byId.get(outcome.from)?.name ?? outcome.from;
			return {
				reply: text || `Bytt ${fromName} mot ${outcome.to.name}.`,
				swap: { from: outcome.from, to: outcome.to, created: outcome.created }
			};
		}
		messages.push(
			{ role: 'assistant', content: response.content },
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: outcome.error }] }
		);
	}
	return { reply: 'Bytet gick inte att genomföra. Försök igen eller välj en annan övning.', swap: null };
}
