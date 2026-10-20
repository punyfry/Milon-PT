import type Anthropic from '@anthropic-ai/sdk';
import {
	ValidationError,
	fitsPhase,
	isExerciseType,
	isObject,
	isPhase,
	normalizeName,
	phaseField,
	slugify,
	sortByPhase,
	targetMatchesType,
	type Exercise,
	type Phase,
	type Target,
	type WorkoutExercise,
	type WorkoutTemplate
} from '../../model';
import { createExercise, listExercises } from '../data/exercises';
import { getLatestWorkout, saveWorkoutVersion } from '../data/workouts';
import type { UserStorage } from '../storage/types';
import { formatTarget } from './prompt';

const target = {
	type: 'object',
	description: 'Mål per set: reps för weight/bodyweight, seconds för time. Den andra är null.',
	properties: {
		reps: { type: ['integer', 'null'] },
		seconds: { type: ['integer', 'null'] }
	},
	required: ['reps', 'seconds'],
	additionalProperties: false
} as const;

/** The part of the workout (#100). Not nullable, so a plain enum is fine for a strict tool. */
const phase = {
	type: 'string',
	enum: ['warmup', 'main', 'cooldown'],
	description: 'warmup = uppvärmning före passet, main = själva passet, cooldown = stretch efter passet'
} as const;

export const BUILDER_TOOLS: Anthropic.Beta.BetaTool[] = [
	{
		name: 'propose_exercise',
		description:
			'Lägger till en övning i passet som byggs, sist i sin del (uppvärmning, pass eller stretch). Använd existingId om övningen finns i katalogen; ' +
			'annars anges name, type och instruction, och övningen skapas. ' +
			'Anropa igen med samma övning för att ändra set eller mål. Med replacesId ersätter övningen en annan i passet, på samma plats.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				existingId: { type: ['string', 'null'], description: 'id från katalogen, eller null för en ny övning' },
				replacesId: { type: ['string', 'null'], description: 'id för övningen i passet som den här ersätter, annars null' },
				name: { type: ['string', 'null'], description: 'Namn på ny övning, annars null' },
				// Strict tools don't accept enum with the type array ['string', 'null'], so null is expressed with anyOf.
				type: { anyOf: [{ type: 'string', enum: ['weight', 'bodyweight', 'time'] }, { type: 'null' }] },
				instruction: { type: ['string', 'null'], description: '2-4 korta punkter, en per rad' },
				sets: { type: 'integer', description: 'Föreslaget antal set' },
				target,
				phase
			},
			required: ['existingId', 'replacesId', 'name', 'type', 'instruction', 'sets', 'target', 'phase'],
			additionalProperties: false
		}
	},
	{
		name: 'remove_exercise',
		description: 'Tar bort en övning ur passet som byggs. Övningen finns kvar i katalogen.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: { exerciseId: { type: 'string', description: 'id för övningen i passet' } },
			required: ['exerciseId'],
			additionalProperties: false
		}
	},
	{
		name: 'set_workout',
		description:
			'Sparar passet med övningarna i ordning. Ett nytt pass blir version 1; när ett befintligt pass redigeras blir det nästa version. ' +
			'Har användaren nyss ändrat ordningen själv sparas den ordningen. ' +
			'Alla exerciseId måste finnas (från katalogen eller från propose_exercise). ' +
			'Uppvärmning (warmup) och stretch (cooldown) är valfria; appen lägger dem före respektive efter passet.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Passets namn, t.ex. "Pass B"' },
				changeNote: { type: 'string', description: 'Kort beskrivning av vad som är nytt eller ändrat' },
				exercises: {
					type: 'array',
					items: {
						type: 'object',
						properties: { exerciseId: { type: 'string' }, sets: { type: 'integer' }, target, phase },
						required: ['exerciseId', 'sets', 'target', 'phase'],
						additionalProperties: false
					}
				}
			},
			required: ['name', 'changeNote', 'exercises'],
			additionalProperties: false
		}
	}
];

/** What the tools need to know about the conversation. Mutated by the tools. */
export interface BuilderState {
	/** The workout being edited, or null until a new workout is saved for the first time. */
	editingSlug: string | null;
	/** The live list: the exercises agreed on so far, in order. */
	draft: WorkoutExercise[];
	saved?: { slug: string; version: number };
	/**
	 * The user reordered the list since Milon's last turn: a save in the next
	 * turn keeps that order when it has the same exercises, whatever order the
	 * model gives. Cleared when that turn ends.
	 */
	userOrder?: boolean;
}

export interface ToolOutcome {
	content: string;
	isError: boolean;
	/** Short line for the chat log, e.g. "Lade till Marklyft". */
	event?: string;
	/** The tool changed the live list; the turn shows the list as a card instead of the event line. */
	changedDraft?: boolean;
}

function parseTarget(v: unknown): Target | null {
	if (!isObject(v)) return null;
	const reps = v.reps;
	const seconds = v.seconds;
	if (typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0 && (reps === null || reps === undefined))
		return { seconds };
	if (typeof reps === 'number' && Number.isInteger(reps) && reps > 0 && (seconds === null || seconds === undefined))
		return { reps };
	return null;
}

const PHASE_NAME = { warmup: 'uppvärmning', cooldown: 'stretch' } as const;
const PHASE_ERROR = 'phase måste vara warmup, main eller cooldown.';

/** The strict schema requires `phase`; a missing one (e.g. a conversation from before #100) means the main part. */
function parsePhase(v: unknown): Phase | null {
	if (v === undefined || v === null) return 'main';
	return isPhase(v) ? v : null;
}

/** Warm-up and stretch are ticked off by time or reps (#100), so they take no weight exercises. */
const extraWeightError = (name: string) =>
	`${name} är en viktövning; uppvärmning och stretch ska vara övningar med tid (time) eller reps (bodyweight).`;

function parseSets(v: unknown): number | null {
	return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 20 ? v : null;
}

const fail = (content: string): ToolOutcome => ({ content, isError: true });

async function proposeExercise(storage: UserStorage, state: BuilderState, input: Record<string, unknown>): Promise<ToolOutcome> {
	const sets = parseSets(input.sets);
	const tgt = parseTarget(input.target);
	if (!sets) return fail('sets måste vara ett heltal mellan 1 och 20.');
	if (!tgt) return fail('target ska ha antingen reps eller seconds (ett positivt heltal), och den andra null.');
	const part = parsePhase(input.phase);
	if (!part) return fail(PHASE_ERROR);

	const catalog = (await listExercises(storage)).map((e) => e.data).filter((e) => !e.deleted);
	let exercise: Exercise | undefined;
	let created = false;

	if (typeof input.existingId === 'string' && input.existingId) {
		exercise = catalog.find((e) => e.id === input.existingId);
		if (!exercise) return fail(`Det finns ingen övning med id ${input.existingId}. Kontrollera katalogen.`);
	} else {
		const name = typeof input.name === 'string' ? input.name.trim() : '';
		if (!name) return fail('Ange name för en ny övning, eller existingId för en befintlig.');
		// Same name as an existing exercise: reuse it instead of creating a duplicate.
		exercise = catalog.find((e) => normalizeName(e.name) === normalizeName(name));
		if (!exercise) {
			if (!isExerciseType(input.type)) return fail('type måste vara weight, bodyweight eller time för en ny övning.');
			const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
			try {
				exercise = (
					await createExercise(
						storage,
						{
							name,
							type: input.type,
							instruction
						},
						new Set(catalog.map((e) => e.id))
					)
				).data;
				created = true;
			} catch (e) {
				if (e instanceof ValidationError) return fail(e.issues.join('; '));
				throw e;
			}
		}
	}

	if (!targetMatchesType(tgt, exercise.type)) {
		return fail(`${exercise.name} är av typen ${exercise.type}; målet ska anges i ${exercise.type === 'time' ? 'seconds' : 'reps'}.`);
	}
	if (!fitsPhase(exercise.type, part)) return fail(extraWeightError(exercise.name));

	const item: WorkoutExercise = { exerciseId: exercise.id, sets, target: tgt, ...phaseField(part) };
	const replacesId = typeof input.replacesId === 'string' && input.replacesId && input.replacesId !== exercise.id ? input.replacesId : null;
	const replaced = replacesId ? state.draft.findIndex((d) => d.exerciseId === replacesId) : -1;
	if (replacesId && replaced < 0) return fail(`${replacesId} finns inte i passet, så den kan inte ersättas.`);
	const index = state.draft.findIndex((d) => d.exerciseId === exercise!.id);
	if (replaced >= 0) {
		const replacedName = catalog.find((e) => e.id === replacesId)?.name ?? replacesId;
		// In the replaced exercise's place; an earlier copy of the new one goes, so it isn't in the list twice.
		state.draft[replaced] = item;
		if (index >= 0) state.draft.splice(index, 1);
		state.draft = sortByPhase(state.draft);
		const summary = `${sets} set × ${formatTarget(tgt)}${part === 'main' ? '' : ` (${PHASE_NAME[part]})`}`;
		return {
			isError: false,
			changedDraft: true,
			content:
				(created ? `Ny övning skapad: ${exercise.id} (${exercise.name}). ` : `Använder befintlig övning ${exercise.id} (${exercise.name}). `) +
				`Ersatte ${replacesId} i passet: ${summary}. Passet har nu ${state.draft.length} övningar.`,
			event: `Bytte ${replacedName} mot ${exercise.name}: ${summary}${created ? ' (ny övning)' : ''}`
		};
	}
	if (index >= 0) state.draft[index] = item;
	else state.draft.push(item);
	// The live list is shown as the workout will run: warm-up first, stretch last.
	state.draft = sortByPhase(state.draft);

	const summary = `${sets} set × ${formatTarget(tgt)}${part === 'main' ? '' : ` (${PHASE_NAME[part]})`}`;
	return {
		isError: false,
		changedDraft: true,
		content:
			(created ? `Ny övning skapad: ${exercise.id} (${exercise.name}). ` : `Använder befintlig övning ${exercise.id} (${exercise.name}). `) +
			`${index >= 0 ? 'Uppdaterad' : 'Tillagd'} i passet: ${summary}. Passet har nu ${state.draft.length} övningar.`,
		event: `${index >= 0 ? 'Uppdaterade' : 'Lade till'} ${exercise.name}: ${summary}${created ? ' (ny övning)' : ''}`
	};
}

async function removeExercise(storage: UserStorage, state: BuilderState, input: Record<string, unknown>): Promise<ToolOutcome> {
	const id = typeof input.exerciseId === 'string' ? input.exerciseId : '';
	const index = state.draft.findIndex((d) => d.exerciseId === id);
	if (index < 0) return fail(`${id || 'Övningen'} finns inte i passet.`);
	state.draft.splice(index, 1);
	const name = (await listExercises(storage)).find((e) => e.data.id === id)?.data.name ?? id;
	return {
		isError: false,
		changedDraft: true,
		content: `Tog bort ${id} ur passet. Passet har nu ${state.draft.length} övningar.`,
		event: `Tog bort ${name}`
	};
}

async function setWorkout(storage: UserStorage, state: BuilderState, input: Record<string, unknown>, today: string): Promise<ToolOutcome> {
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name || !slugify(name)) return fail('Passet behöver ett namn.');
	const changeNote = typeof input.changeNote === 'string' ? input.changeNote.trim() : '';
	if (!Array.isArray(input.exercises) || input.exercises.length === 0) return fail('Passet behöver minst en övning.');

	const catalog = new Map((await listExercises(storage)).filter((e) => !e.data.deleted).map((e) => [e.data.id, e.data]));
	const exercises: WorkoutExercise[] = [];
	const problems: string[] = [];
	input.exercises.forEach((x, i) => {
		if (!isObject(x)) return problems.push(`exercises[${i}] är ogiltig`);
		const ex = typeof x.exerciseId === 'string' ? catalog.get(x.exerciseId) : undefined;
		const sets = parseSets(x.sets);
		const tgt = parseTarget(x.target);
		if (!ex) return problems.push(`exercises[${i}]: okänt exerciseId ${String(x.exerciseId)}`);
		if (!sets) return problems.push(`exercises[${i}]: sets måste vara 1-20`);
		if (!tgt || !targetMatchesType(tgt, ex.type))
			return problems.push(`exercises[${i}]: målet för ${ex.name} ska anges i ${ex.type === 'time' ? 'seconds' : 'reps'}`);
		const part = parsePhase(x.phase);
		if (!part) return problems.push(`exercises[${i}]: ${PHASE_ERROR}`);
		if (!fitsPhase(ex.type, part)) return problems.push(`exercises[${i}]: ${extraWeightError(ex.name)}`);
		if (exercises.some((e) => e.exerciseId === ex.id)) return problems.push(`exercises[${i}]: ${ex.name} finns redan i passet`);
		exercises.push({ exerciseId: ex.id, sets, target: tgt, ...phaseField(part) });
	});
	if (problems.length) return fail(problems.join('; '));
	let ordered = sortByPhase(exercises);
	// The order the user just set wins over the model's, as long as it is the same exercises.
	if (state.userOrder && sameExercises(ordered, state.draft)) {
		const byId = new Map(ordered.map((e) => [e.exerciseId, e]));
		ordered = sortByPhase(state.draft.map((d) => byId.get(d.exerciseId)!));
	}

	let slug = state.editingSlug;
	if (!slug) {
		slug = slugify(name);
		const existing = await getLatestWorkout(storage, slug);
		if (existing) {
			return fail(
				`Det finns redan ett pass som heter "${existing.name}". Fråga användaren om ett annat namn, ` +
					`eller om det befintliga passet ska redigeras (då ska det öppnas för redigering i appen).`
			);
		}
	}

	const saved: WorkoutTemplate = await saveWorkoutVersion(storage, {
		slug,
		name,
		createdAt: today,
		...(changeNote ? { changeNote } : {}),
		exercises: ordered
	});
	state.editingSlug = slug;
	state.draft = ordered;
	state.saved = { slug, version: saved.version };
	return {
		isError: false,
		content: `Passet är sparat som ${saved.name}, version ${saved.version}.`,
		event: `Sparade ${saved.name} (version ${saved.version})`
	};
}

function sameExercises(a: readonly WorkoutExercise[], b: readonly WorkoutExercise[]): boolean {
	const ids = new Set(b.map((e) => e.exerciseId));
	return a.length === b.length && a.every((e) => ids.has(e.exerciseId));
}

/** Runs a tool call. Invalid input becomes an error result to the model, not an exception. */
export async function executeTool(
	storage: UserStorage,
	state: BuilderState,
	name: string,
	input: unknown,
	today: string
): Promise<ToolOutcome> {
	if (!isObject(input)) return fail('Indata måste vara ett objekt.');
	if (name === 'propose_exercise') return proposeExercise(storage, state, input);
	if (name === 'remove_exercise') return removeExercise(storage, state, input);
	if (name === 'set_workout') return setWorkout(storage, state, input, today);
	return fail(`Okänt verktyg: ${name}`);
}
