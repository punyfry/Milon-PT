import type Anthropic from '@anthropic-ai/sdk';
import {
	ValidationError,
	isExerciseType,
	isLoadClass,
	isObject,
	normalizeName,
	slugify,
	targetMatchesType,
	type Exercise,
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

export const BUILDER_TOOLS: Anthropic.Beta.BetaTool[] = [
	{
		name: 'propose_exercise',
		description:
			'Lägger till en övning som användaren har godkänt i passet som byggs. Använd existingId om övningen finns i katalogen; ' +
			'annars anges name, type, loadClass (bara för weight) och instruction, och övningen skapas. ' +
			'Anropa igen med samma övning för att ändra set eller mål.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				existingId: { type: ['string', 'null'], description: 'id från katalogen, eller null för en ny övning' },
				name: { type: ['string', 'null'], description: 'Namn på ny övning, annars null' },
				type: { type: ['string', 'null'], enum: ['weight', 'bodyweight', 'time', null] },
				loadClass: { type: ['string', 'null'], enum: ['light', 'heavy', null], description: 'Bara för weight' },
				instruction: { type: ['string', 'null'], description: '2-4 korta punkter, en per rad' },
				sets: { type: 'integer', description: 'Föreslaget antal set' },
				target
			},
			required: ['existingId', 'name', 'type', 'loadClass', 'instruction', 'sets', 'target'],
			additionalProperties: false
		}
	},
	{
		name: 'set_workout',
		description:
			'Sparar passet med övningarna i ordning. Ett nytt pass blir version 1; när ett befintligt pass redigeras blir det nästa version. ' +
			'Alla exerciseId måste finnas (från katalogen eller från propose_exercise).',
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
						properties: { exerciseId: { type: 'string' }, sets: { type: 'integer' }, target },
						required: ['exerciseId', 'sets', 'target'],
						additionalProperties: false
					}
				}
			},
			required: ['name', 'changeNote', 'exercises'],
			additionalProperties: false
		}
	}
];

/** Det verktygen behöver känna till om konversationen. Ändras av verktygen. */
export interface BuilderState {
	/** Passet som redigeras, eller null tills ett nytt pass sparats första gången. */
	editingSlug: string | null;
	/** Live-listan: övningarna som diskuterats fram, i ordning. */
	draft: WorkoutExercise[];
	saved?: { slug: string; version: number };
}

export interface ToolOutcome {
	content: string;
	isError: boolean;
	/** Kort rad för chattloggen, t.ex. "Lade till Marklyft". */
	event?: string;
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

function parseSets(v: unknown): number | null {
	return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 20 ? v : null;
}

const fail = (content: string): ToolOutcome => ({ content, isError: true });

async function proposeExercise(storage: UserStorage, state: BuilderState, input: Record<string, unknown>): Promise<ToolOutcome> {
	const sets = parseSets(input.sets);
	const tgt = parseTarget(input.target);
	if (!sets) return fail('sets måste vara ett heltal mellan 1 och 20.');
	if (!tgt) return fail('target ska ha antingen reps eller seconds (ett positivt heltal), och den andra null.');

	const catalog = (await listExercises(storage)).map((e) => e.data);
	let exercise: Exercise | undefined;
	let created = false;

	if (typeof input.existingId === 'string' && input.existingId) {
		exercise = catalog.find((e) => e.id === input.existingId);
		if (!exercise) return fail(`Det finns ingen övning med id ${input.existingId}. Kontrollera katalogen.`);
	} else {
		const name = typeof input.name === 'string' ? input.name.trim() : '';
		if (!name) return fail('Ange name för en ny övning, eller existingId för en befintlig.');
		// Samma namn som en befintlig övning: återanvänd den i stället för att skapa en dubblett.
		exercise = catalog.find((e) => normalizeName(e.name) === normalizeName(name));
		if (!exercise) {
			if (!isExerciseType(input.type)) return fail('type måste vara weight, bodyweight eller time för en ny övning.');
			if (input.type === 'weight' && !isLoadClass(input.loadClass))
				return fail('loadClass (light eller heavy) krävs för en weight-övning.');
			const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
			try {
				exercise = (
					await createExercise(
						storage,
						{
							name,
							type: input.type,
							...(input.type === 'weight' && isLoadClass(input.loadClass) ? { loadClass: input.loadClass } : {}),
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

	const item: WorkoutExercise = { exerciseId: exercise.id, sets, target: tgt };
	const index = state.draft.findIndex((d) => d.exerciseId === exercise!.id);
	if (index >= 0) state.draft[index] = item;
	else state.draft.push(item);

	const summary = `${sets} set × ${formatTarget(tgt)}`;
	return {
		isError: false,
		content:
			(created ? `Ny övning skapad: ${exercise.id} (${exercise.name}). ` : `Använder befintlig övning ${exercise.id} (${exercise.name}). `) +
			`${index >= 0 ? 'Uppdaterad' : 'Tillagd'} i passet: ${summary}. Passet har nu ${state.draft.length} övningar.`,
		event: `${index >= 0 ? 'Uppdaterade' : 'Lade till'} ${exercise.name}: ${summary}${created ? ' (ny övning)' : ''}`
	};
}

async function setWorkout(storage: UserStorage, state: BuilderState, input: Record<string, unknown>, today: string): Promise<ToolOutcome> {
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name || !slugify(name)) return fail('Passet behöver ett namn.');
	const changeNote = typeof input.changeNote === 'string' ? input.changeNote.trim() : '';
	if (!Array.isArray(input.exercises) || input.exercises.length === 0) return fail('Passet behöver minst en övning.');

	const catalog = new Map((await listExercises(storage)).map((e) => [e.data.id, e.data]));
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
		exercises.push({ exerciseId: ex.id, sets, target: tgt });
	});
	if (problems.length) return fail(problems.join('; '));

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
		exercises
	});
	state.editingSlug = slug;
	state.draft = exercises;
	state.saved = { slug, version: saved.version };
	return {
		isError: false,
		content: `Passet är sparat som ${saved.name}, version ${saved.version}.`,
		event: `Sparade ${saved.name} (version ${saved.version})`
	};
}

/** Kör ett verktygsanrop. Fel i indata blir felsvar till modellen, inte undantag. */
export async function executeTool(
	storage: UserStorage,
	state: BuilderState,
	name: string,
	input: unknown,
	today: string
): Promise<ToolOutcome> {
	if (!isObject(input)) return fail('Indata måste vara ett objekt.');
	if (name === 'propose_exercise') return proposeExercise(storage, state, input);
	if (name === 'set_workout') return setWorkout(storage, state, input, today);
	return fail(`Okänt verktyg: ${name}`);
}
