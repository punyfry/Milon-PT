/**
 * Saving a workout built by hand, without Milon: a new workout becomes
 * version 1, an edited one the next version. Exercises written in are created
 * first (or matched by name and type), so a retry after a failure creates no
 * duplicates.
 */
import {
	Issues,
	ValidationError,
	isObject,
	issueText,
	normalizeName,
	slugify,
	targetMatchesType,
	validateExerciseInput,
	type Exercise,
	type Target,
	type WorkoutExercise,
	type WorkoutTemplate
} from '../../model';
import type { UserStorage } from '../storage/types';
import { findOrCreateExercise, listExercises } from './exercises';
import { getLatestWorkout, saveWorkoutVersion } from './workouts';

export const MAX_WORKOUT_EXERCISES = 30;
export const MAX_WORKOUT_NAME = 60;

export type ManualItem = { sets: number; target: Target } & (
	| { exerciseId: string }
	| { newExercise: Pick<Exercise, 'name' | 'type' | 'instruction'> }
);

export interface ManualWorkoutInput {
	/** The workout being edited, or null for a new one. */
	editSlug: string | null;
	name: string;
	items: ManualItem[];
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;

function parseTarget(v: unknown): Target | null {
	if (!isObject(v)) return null;
	const keys = Object.keys(v);
	if (keys.length !== 1) return null;
	const n = keys[0] === 'reps' ? v.reps : keys[0] === 'seconds' ? v.seconds : undefined;
	const max = keys[0] === 'reps' ? 999 : 3600;
	if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) return null;
	return keys[0] === 'reps' ? { reps: n } : { seconds: n };
}

/** Checks the input before anything is read from storage. Messages are shown to the user. */
export function parseManualWorkoutInput(raw: unknown): ManualWorkoutInput {
	const issues = new Issues();
	if (!isObject(raw)) throw new ValidationError('pass', ['Ogiltig JSON']);
	const editSlug = raw.editSlug === undefined || raw.editSlug === null ? null : raw.editSlug;
	if (editSlug !== null && (typeof editSlug !== 'string' || !/^[a-z0-9-]{1,80}$/.test(editSlug))) issues.add('', 'Ogiltigt pass att redigera.');
	const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
	if (!name || !slugify(name)) issues.add('', 'Passet behöver ett namn.');
	else if (name.length > MAX_WORKOUT_NAME) issues.add('', `Namnet får vara högst ${MAX_WORKOUT_NAME} tecken.`);

	const items: ManualItem[] = [];
	if (!Array.isArray(raw.items) || raw.items.length === 0) issues.add('', 'Passet behöver minst en övning.');
	else if (raw.items.length > MAX_WORKOUT_EXERCISES) issues.add('', `Ett pass kan ha högst ${MAX_WORKOUT_EXERCISES} övningar.`);
	else
		raw.items.forEach((x, i) => {
			const label = `Övning ${i + 1}`;
			if (!isObject(x)) return issues.add('', `${label} är ogiltig.`);
			const sets = x.sets;
			if (typeof sets !== 'number' || !Number.isInteger(sets) || sets < 1 || sets > 20) issues.add('', `${label}: antal set ska vara 1–20.`);
			const target = parseTarget(x.target);
			if (!target) issues.add('', `${label}: ange mål i reps (1–999) eller sekunder (1–3600).`);
			let item: ManualItem | null = null;
			if (typeof x.exerciseId === 'string' && x.newExercise === undefined) {
				if (!ID.test(x.exerciseId)) issues.add('', `${label}: ogiltigt övnings-ID.`);
				else item = { exerciseId: x.exerciseId, sets: sets as number, target: target! };
			} else if (x.exerciseId === undefined && x.newExercise !== undefined) {
				const found = new Issues();
				const fields = validateExerciseInput(x.newExercise, found, '');
				for (const issue of found.list) issues.add('', `${label}: ${issueText(issue)}`);
				if (fields) item = { newExercise: fields, sets: sets as number, target: target! };
			} else issues.add('', `${label}: välj en övning eller skriv in en ny.`);
			if (item && target) items.push(item);
		});
	if (!issues.ok) throw new ValidationError('pass', issues.list);
	return { editSlug: editSlug as string | null, name, items };
}

/** A short change note for the version list, e.g. "Lade till Hantelrodd, ändrade set eller mål". */
export function describeChange(before: WorkoutTemplate | null, after: Pick<WorkoutTemplate, 'name' | 'exercises'>, names: ReadonlyMap<string, string>): string {
	if (!before) return 'Byggt för hand';
	const name = (id: string) => names.get(id) ?? id;
	const old = new Map(before.exercises.map((e) => [e.exerciseId, e]));
	const now = new Map(after.exercises.map((e) => [e.exerciseId, e]));
	const parts: string[] = [];
	if (before.name !== after.name) parts.push(`nytt namn ${after.name}`);
	const added = after.exercises.filter((e) => !old.has(e.exerciseId)).map((e) => name(e.exerciseId));
	const removed = before.exercises.filter((e) => !now.has(e.exerciseId)).map((e) => name(e.exerciseId));
	if (added.length) parts.push(`lade till ${added.join(', ')}`);
	if (removed.length) parts.push(`tog bort ${removed.join(', ')}`);
	const kept = after.exercises.filter((e) => old.has(e.exerciseId));
	if (kept.some((e) => JSON.stringify(old.get(e.exerciseId)) !== JSON.stringify(e))) parts.push('ändrade set eller mål');
	const order = (list: WorkoutExercise[]) => list.filter((e) => old.has(e.exerciseId) && now.has(e.exerciseId)).map((e) => e.exerciseId).join();
	if (order(before.exercises) !== order(after.exercises)) parts.push('ny ordning');
	const text = parts.join(', ') || 'Inga ändringar';
	return text[0].toUpperCase() + text.slice(1);
}

export interface ManualWorkoutResult {
	slug: string;
	version: number;
	/** False when nothing changed and no new version was saved. */
	saved: boolean;
}

export async function saveManualWorkout(storage: UserStorage, input: ManualWorkoutInput, today: string): Promise<ManualWorkoutResult> {
	let base: WorkoutTemplate | null = null;
	let slug: string;
	if (input.editSlug) {
		base = await getLatestWorkout(storage, input.editSlug);
		if (!base) throw new ValidationError('pass', ['Passet finns inte längre.']);
		slug = base.slug;
	} else {
		slug = slugify(input.name);
		const existing = await getLatestWorkout(storage, slug);
		if (existing) throw new ValidationError('pass', [`Det finns redan ett pass som heter ${existing.name}. Välj ett annat namn eller redigera det passet.`]);
	}

	const catalog = (await listExercises(storage)).map((e) => e.data);
	const byId = new Map(catalog.map((e) => [e.id, e]));
	const problems: string[] = [];
	for (const [i, item] of input.items.entries()) {
		if (!('exerciseId' in item)) continue;
		const ex = byId.get(item.exerciseId);
		if (!ex) problems.push(`Övning ${i + 1} finns inte längre.`);
		else if (!targetMatchesType(item.target, ex.type)) problems.push(`${ex.name}: målet ska anges i ${ex.type === 'time' ? 'sekunder' : 'reps'}.`);
	}
	for (const [i, item] of input.items.entries()) {
		if ('newExercise' in item && !targetMatchesType(item.target, item.newExercise.type))
			problems.push(`Övning ${i + 1}: målet ska anges i ${item.newExercise.type === 'time' ? 'sekunder' : 'reps'}.`);
	}
	// The same exercise twice is caught before anything is created. A new one
	// with the name and type of an existing one is that exercise (see findOrCreateExercise).
	const keyOf = (item: ManualItem) => {
		if ('exerciseId' in item) return item.exerciseId;
		const { name, type } = item.newExercise;
		const match = catalog.find((e) => !e.archived && e.type === type && normalizeName(e.name) === normalizeName(name));
		return match?.id ?? `new:${type}:${normalizeName(name)}`;
	};
	const seen = new Set<string>();
	for (const item of input.items) {
		const key = keyOf(item);
		if (seen.has(key)) {
			const name = 'exerciseId' in item ? byId.get(item.exerciseId)!.name : item.newExercise.name;
			problems.push(`${byId.get(key)?.name ?? name} finns två gånger i passet.`);
		}
		seen.add(key);
	}
	if (problems.length) throw new ValidationError('pass', problems);

	const exercises: WorkoutExercise[] = [];
	for (const item of input.items) {
		const id = 'exerciseId' in item ? item.exerciseId : (await findOrCreateExercise(storage, catalog, item.newExercise)).exercise.id;
		exercises.push({ exerciseId: id, sets: item.sets, target: item.target });
	}

	if (base && base.name === input.name && JSON.stringify(base.exercises) === JSON.stringify(exercises)) {
		return { slug, version: base.version, saved: false };
	}
	const names = new Map(catalog.map((e) => [e.id, e.name]));
	const saved = await saveWorkoutVersion(storage, {
		slug,
		name: input.name,
		createdAt: today,
		changeNote: describeChange(base, { name: input.name, exercises }, names),
		exercises
	});
	return { slug, version: saved.version, saved: true };
}
