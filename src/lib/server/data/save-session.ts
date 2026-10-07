/**
 * Sparar ett avslutat pass:
 * övningsloggar, eventuellt en ny passversion och sist sessionsposten.
 *
 * Sparningen går att köra om: misslyckas den halvvägs och klienten försöker
 * igen hoppas redan skrivna loggposter (samma sessionId) och en redan skapad
 * passversion över. Sessionsposten skrivs sist och markerar att allt är klart.
 */
import {
	Issues,
	ValidationError,
	isObject,
	sessionIdFor,
	targetMatchesType,
	validateSet,
	type ActiveSession,
	type Deviation,
	type Exercise,
	type ExerciseSet,
	type SessionRecord,
	type Target,
	type WorkoutTemplate
} from '../../model';
import type { UserStorage } from '../storage/types';
import { getExercise, prependLogEntry } from './exercises';
import { createSession, getSession, listSessionIds } from './sessions';
import { getLatestWorkout, getWorkout, saveWorkoutVersion } from './workouts';

export interface SaveSessionInput {
	session: ActiveSession;
	endedAt: string;
	kcalEstimate?: number;
	/** Spara avvikelserna som ny version av passet. */
	saveAsNewVersion: boolean;
}

export interface SaveSessionResult {
	sessionId: string;
	newWorkoutVersion?: number;
	alreadySaved: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Grundkontroll av ett pågående pass från klienten (localStorage), innan
 * något läses från lagringen. Lägger fel i `issues` och returnerar passet.
 */
export function checkActiveSession(raw: unknown, issues: string[]): ActiveSession | null {
	if (!isObject(raw)) {
		issues.push('session saknas');
		return null;
	}
	const s = raw;
	if (typeof s.sessionId !== 'string' || !ID.test(s.sessionId)) issues.push('session.sessionId är ogiltigt');
	if (typeof s.workoutSlug !== 'string' || !/^[a-z0-9-]+$/.test(s.workoutSlug)) issues.push('session.workoutSlug är ogiltig');
	if (typeof s.workoutVersion !== 'number' || !Number.isInteger(s.workoutVersion) || s.workoutVersion < 1)
		issues.push('session.workoutVersion är ogiltig');
	for (const key of ['startedAt', 'lastActivityAt'] as const) {
		if (typeof s[key] !== 'string' || !DATETIME.test(s[key] as string)) issues.push(`session.${key} är ogiltig`);
	}
	if (!Array.isArray(s.exercises)) issues.push('session.exercises måste vara en lista');
	else
		s.exercises.forEach((ex, i) => {
			if (!isObject(ex) || typeof ex.exerciseId !== 'string' || !ID.test(ex.exerciseId) || !Array.isArray(ex.sets))
				issues.push(`session.exercises[${i}] är ogiltig`);
		});
	if (!Array.isArray(s.deviations)) issues.push('session.deviations måste vara en lista');
	else
		s.deviations.forEach((d, i) => {
			if (!isObject(d) || d.type !== 'swap' || typeof d.from !== 'string' || !ID.test(d.from) || typeof d.to !== 'string' || !ID.test(d.to))
				issues.push(`session.deviations[${i}] är ogiltig`);
		});
	return s as unknown as ActiveSession;
}

/** Grundkontroll av indata för sparning innan något läses från lagringen. */
export function parseSaveSessionInput(raw: unknown): SaveSessionInput {
	const issues: string[] = [];
	if (!isObject(raw) || !isObject(raw.session)) throw new ValidationError('sparning', ['session saknas']);
	const session = checkActiveSession(raw.session, issues);
	if (typeof raw.endedAt !== 'string' || !DATETIME.test(raw.endedAt)) issues.push('endedAt är ogiltig');
	const kcal = raw.kcalEstimate;
	if (kcal !== undefined && kcal !== null && (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal < 0 || kcal > 5000))
		issues.push('kcalEstimate är ogiltig');
	if (issues.length || !session) throw new ValidationError('sparning', issues);
	return {
		session,
		endedAt: raw.endedAt as string,
		...(typeof kcal === 'number' ? { kcalEstimate: Math.round(kcal) } : {}),
		saveAsNewVersion: raw.saveAsNewVersion === true
	};
}

/**
 * Bygger nästa version av passet med avvikelserna inlagda: varje bytt
 * övning ersätts på sin plats. Byts typ (t.ex. reps → tid) tas målet från
 * setet som gjordes under passet.
 */
export function applyDeviations(
	base: WorkoutTemplate,
	deviations: readonly Deviation[],
	exercises: ReadonlyMap<string, Exercise>,
	doneSets: ReadonlyMap<string, ExerciseSet[]>
): WorkoutTemplate['exercises'] {
	const swaps = new Map(deviations.filter((d) => d.type === 'swap').map((d) => [d.from, d.to]));
	return base.exercises.map((we) => {
		const to = swaps.get(we.exerciseId);
		if (!to) return we;
		const type = exercises.get(to)?.type;
		let target: Target = we.target;
		if (type && !targetMatchesType(target, type)) {
			const first = doneSets.get(to)?.[0];
			target =
				type === 'time'
					? { seconds: first && 'seconds' in first && first.seconds > 0 ? first.seconds : 30 }
					: { reps: first && 'reps' in first && first.reps > 0 ? first.reps : 8 };
		}
		return { exerciseId: to, sets: we.sets, target };
	});
}

export async function saveSession(storage: UserStorage, input: SaveSessionInput): Promise<SaveSessionResult> {
	const { session } = input;
	const date = session.startedAt.slice(0, 10);

	const base = (await getWorkout(storage, session.workoutSlug, session.workoutVersion))?.data;
	if (!base) throw new ValidationError('sparning', [`Passet ${session.workoutSlug} v${session.workoutVersion} finns inte`]);

	// Läs övningarna och validera de klara seten mot respektive typ.
	const exercises = new Map<string, Exercise>();
	const doneSets = new Map<string, ExerciseSet[]>();
	const issues = new Issues();
	for (const [i, ex] of session.exercises.entries()) {
		const stored = await getExercise(storage, ex.exerciseId);
		if (!stored) {
			issues.add(`session.exercises[${i}]`, `övningen ${ex.exerciseId} finns inte`);
			continue;
		}
		exercises.set(ex.exerciseId, stored.data);
		const sets = ex.sets
			.map((set, j) => ({ set, j }))
			.filter(({ set }) => isObject(set) && set.done === true)
			.map(({ set, j }) => validateSet(set, stored.data.type, issues, `session.exercises[${i}].sets[${j}]`))
			.filter((s) => s !== null);
		if (sets.length) doneSets.set(ex.exerciseId, [...(doneSets.get(ex.exerciseId) ?? []), ...sets]);
	}
	if (!issues.ok) throw new ValidationError('sparning', issues.list);
	if (doneSets.size === 0) throw new ValidationError('sparning', ['Inga set är markerade som klara']);

	// Bestäm sessions-id. Finns redan en post med samma id och starttid är
	// det en omkörning; annars väljs ett ledigt id för dagen.
	let sessionId = session.sessionId;
	let alreadySaved = false;
	const existing = await getSession(storage, sessionId);
	if (existing) {
		if (existing.data.startedAt === session.startedAt) alreadySaved = true;
		else sessionId = sessionIdFor(date, new Set(await listSessionIds(storage)));
	}

	// Övningsloggar, utan dubbletter vid omkörning.
	for (const [exerciseId, sets] of doneSets) {
		if (exercises.get(exerciseId)!.log.some((e) => e.sessionId === sessionId)) continue;
		await prependLogEntry(storage, exerciseId, { sessionId, date, sets });
	}

	// Ny passversion med avvikelserna, om användaren vill.
	let newWorkoutVersion: number | undefined;
	if (input.saveAsNewVersion && session.deviations.length) {
		const next = applyDeviations(base, session.deviations, exercises, doneSets);
		const latest = await getLatestWorkout(storage, base.slug);
		const unchanged = latest && JSON.stringify(latest.exercises) === JSON.stringify(next);
		if (unchanged) {
			if (latest.version !== base.version) newWorkoutVersion = latest.version;
		} else {
			const names = new Map([...exercises.values()].map((e) => [e.id, e.name]));
			for (const d of session.deviations) {
				if (!names.has(d.from)) {
					const from = await getExercise(storage, d.from);
					if (from) names.set(d.from, from.data.name);
				}
			}
			const name = (id: string) => names.get(id) ?? id;
			const saved = await saveWorkoutVersion(storage, {
				slug: base.slug,
				name: base.name,
				createdAt: date,
				changeNote: session.deviations.map((d) => `Byt ${name(d.from)} mot ${name(d.to)}`).join(', '),
				exercises: next
			});
			newWorkoutVersion = saved.version;
		}
	}

	if (!alreadySaved) {
		const record: SessionRecord = {
			id: sessionId,
			workoutSlug: session.workoutSlug,
			workoutVersion: session.workoutVersion,
			startedAt: session.startedAt,
			endedAt: input.endedAt,
			exerciseIds: [...doneSets.keys()],
			deviations: session.deviations,
			...(input.kcalEstimate !== undefined ? { kcalEstimate: input.kcalEstimate } : {})
		};
		await createSession(storage, record);
	}

	return { sessionId, alreadySaved, ...(newWorkoutVersion ? { newWorkoutVersion } : {}) };
}
