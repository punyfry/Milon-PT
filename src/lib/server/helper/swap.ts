import type Anthropic from '@anthropic-ai/sdk';
import { isExerciseType, isLoadClass, isObject, normalizeName, type ActiveSession, type Exercise } from '../../model';
import { bestEver, heaviestEver } from '../../history/stats';
import type { ExerciseInfo } from '../../session/active';
import { createExercise } from '../data/exercises';
import type { UserStorage } from '../storage/types';

const nullableEnum = (values: string[], description?: string) => ({
	// Strikta verktyg godtar inte enum ihop med type-listan ['string', 'null'], så null uttrycks med anyOf.
	anyOf: [{ type: 'string', enum: values }, { type: 'null' }],
	...(description ? { description } : {})
});

export const SWAP_TOOL: Anthropic.Beta.BetaTool = {
	name: 'swap_exercise',
	description:
		'Byter en övning i det pågående passet mot en annan, när användaren har valt. Använd toExerciseId för en övning i katalogen; ' +
		'annars newExercise för att skapa en ny. Appen lägger bytet som avvikelse i passet; vikter och set ändras inte av dig.',
	strict: true,
	input_schema: {
		type: 'object',
		properties: {
			fromExerciseId: { type: 'string', description: 'id för övningen som byts ut (finns i passet)' },
			toExerciseId: { type: ['string', 'null'], description: 'id från katalogen, eller null om newExercise anges' },
			newExercise: {
				anyOf: [
					{
						type: 'object',
						properties: {
							name: { type: 'string', description: 'Svenskt namn när det finns ett vedertaget, t.ex. Hantelrodd' },
							type: { type: 'string', enum: ['weight', 'bodyweight', 'time'] },
							loadClass: nullableEnum(
								['light', 'heavy'],
								'Bara för weight, annars null. Styr viktstegen: light (hantlar, kabel, isolationsövningar, steg 1,25 kg) eller heavy (skivstång, tunga basövningar, steg 5 kg).'
							),
							instruction: { type: 'string', description: '2-4 korta punkter, en per rad' }
						},
						required: ['name', 'type', 'loadClass', 'instruction'],
						additionalProperties: false
					},
					{ type: 'null' }
				]
			}
		},
		required: ['fromExerciseId', 'toExerciseId', 'newExercise'],
		additionalProperties: false
	}
};

export function toInfo(e: Exercise): ExerciseInfo {
	const best = bestEver(e);
	const heaviest = heaviestEver(e);
	return {
		id: e.id,
		name: e.name,
		type: e.type,
		...(e.loadClass ? { loadClass: e.loadClass } : {}),
		instruction: e.instruction,
		...(e.log[0] ? { lastEntry: e.log[0] } : {}),
		...(best !== null ? { best } : {}),
		...(heaviest !== null ? { heaviest } : {})
	};
}

export type SwapOutcome = { ok: true; from: string; to: ExerciseInfo; created: boolean } | { ok: false; error: string };

/**
 * Kontrollerar ett byte och skapar vid behov den nya övningen. Själva bytet
 * i passet görs av klienten, eftersom passet lever i localStorage.
 */
export async function executeSwap(
	storage: UserStorage,
	session: ActiveSession,
	catalog: readonly Exercise[],
	input: unknown
): Promise<SwapOutcome> {
	if (!isObject(input)) return { ok: false, error: 'Indata måste vara ett objekt.' };
	const inSession = new Set(session.exercises.map((e) => e.exerciseId));
	const from = typeof input.fromExerciseId === 'string' ? input.fromExerciseId : '';
	if (!inSession.has(from)) return { ok: false, error: `${from || 'fromExerciseId'} finns inte i det pågående passet.` };

	let to: Exercise | undefined;
	let created = false;
	if (typeof input.toExerciseId === 'string' && input.toExerciseId) {
		to = catalog.find((e) => e.id === input.toExerciseId && !e.archived);
		if (!to) return { ok: false, error: `Det finns ingen övning med id ${input.toExerciseId} i katalogen.` };
	} else if (isObject(input.newExercise)) {
		const n = input.newExercise;
		const name = typeof n.name === 'string' ? n.name.trim() : '';
		if (!name) return { ok: false, error: 'newExercise.name saknas.' };
		to = catalog.find((e) => normalizeName(e.name) === normalizeName(name) && !e.archived);
		if (!to) {
			if (!isExerciseType(n.type)) return { ok: false, error: 'newExercise.type måste vara weight, bodyweight eller time.' };
			if (n.type === 'weight' && !isLoadClass(n.loadClass)) return { ok: false, error: 'loadClass krävs för en weight-övning.' };
			to = (
				await createExercise(
					storage,
					{
						name,
						type: n.type,
						...(n.type === 'weight' && isLoadClass(n.loadClass) ? { loadClass: n.loadClass } : {}),
						instruction: typeof n.instruction === 'string' ? n.instruction.trim() : ''
					},
					new Set(catalog.map((e) => e.id))
				)
			).data;
			created = true;
		}
	} else {
		return { ok: false, error: 'Ange toExerciseId eller newExercise.' };
	}

	if (to.id === from) return { ok: false, error: 'Det är samma övning.' };
	if (inSession.has(to.id)) return { ok: false, error: `${to.name} finns redan i passet.` };
	return { ok: true, from, to: toInfo(to), created };
}
