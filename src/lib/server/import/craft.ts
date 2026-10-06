/**
 * Engångsimport från Craft (SPEC.md, "Historik och import").
 *
 * Flödet är uppdelat så att det kan torrköras och testas:
 * 1. `parseImportFile` validerar hela filen och samlar alla fel.
 * 2. `planImport` jämför mot befintliga data och räknar ut vad som ska
 *    skapas eller ändras, utan att skriva något.
 * 3. `applyImport` skriver planen via lagringsgränssnittet.
 *
 * Övningsnamn matchas mot befintliga övningar (skiftläges- och
 * blankstegsokänsligt) innan nya skapas. Importen går att köra om med samma
 * fil: identiska loggposter och oförändrade pass hoppas över.
 */
import {
	Issues,
	ValidationError,
	exerciseIdBase,
	isExerciseType,
	isLoadClass,
	isObject,
	normalizeName,
	slugify,
	targetMatchesType,
	uniqueId,
	validateLogEntry,
	validateTarget,
	workoutFileName,
	type Exercise,
	type ExerciseType,
	type LoadClass,
	type LogEntry,
	type Target,
	type WorkoutExercise,
	type WorkoutTemplate
} from '../../model';
import { listExercises, saveExercise, sortLog } from '../data/exercises';
import { listLatestWorkouts } from '../data/workouts';
import type { StoredJson, UserStorage } from '../storage/types';

// --- filformat ----------------------------------------------------------

export interface ImportExercise {
	name: string;
	type: ExerciseType;
	loadClass?: LoadClass;
	instruction: string;
	log: LogEntry[];
}

export interface ImportWorkout {
	name: string;
	exercises: { name: string; sets: number; target: Target }[];
}

export interface ImportFile {
	exercises: ImportExercise[];
	workouts: ImportWorkout[];
}

export function parseImportFile(raw: unknown): ImportFile {
	const issues = new Issues();
	if (!isObject(raw)) throw new ValidationError('importfil', ['roten måste vara ett objekt']);

	const exercises: ImportExercise[] = [];
	const seen = new Map<string, string>();
	const rawExercises = raw.exercises ?? [];
	if (!Array.isArray(rawExercises)) issues.add('exercises', 'måste vara en lista');
	else
		rawExercises.forEach((e, i) => {
			const p = `exercises[${i}]`;
			if (!isObject(e)) return issues.add(p, 'måste vara ett objekt');
			const name = typeof e.name === 'string' ? e.name.trim() : '';
			if (!name) issues.add(`${p}.name`, 'måste vara en icke-tom sträng');
			const key = normalizeName(name);
			if (name && seen.has(key)) issues.add(`${p}.name`, `"${name}" finns redan som ${seen.get(key)}`);
			seen.set(key, p);
			if (!isExerciseType(e.type)) return issues.add(`${p}.type`, 'måste vara weight, bodyweight eller time');
			if (e.loadClass !== undefined && !isLoadClass(e.loadClass))
				issues.add(`${p}.loadClass`, 'måste vara light eller heavy');
			if (e.instruction !== undefined && typeof e.instruction !== 'string')
				issues.add(`${p}.instruction`, 'måste vara en sträng');
			const rawLog = e.log ?? [];
			if (!Array.isArray(rawLog)) return issues.add(`${p}.log`, 'måste vara en lista');
			const log = rawLog.map((entry, j) => validateLogEntry(entry, e.type as ExerciseType, issues, `${p}.log[${j}]`));
			exercises.push({
				name,
				type: e.type,
				...(e.type === 'weight' && isLoadClass(e.loadClass) ? { loadClass: e.loadClass } : {}),
				instruction: typeof e.instruction === 'string' ? e.instruction.trim() : '',
				log: log.filter((l) => l !== null)
			});
		});

	const workouts: ImportWorkout[] = [];
	const rawWorkouts = raw.workouts ?? [];
	const seenSlugs = new Map<string, string>();
	if (!Array.isArray(rawWorkouts)) issues.add('workouts', 'måste vara en lista');
	else
		rawWorkouts.forEach((w, i) => {
			const p = `workouts[${i}]`;
			if (!isObject(w)) return issues.add(p, 'måste vara ett objekt');
			const name = typeof w.name === 'string' ? w.name.trim() : '';
			if (!name || !slugify(name)) issues.add(`${p}.name`, 'måste vara en icke-tom sträng');
			const slug = slugify(name);
			if (slug && seenSlugs.has(slug)) issues.add(`${p}.name`, `ger samma slug "${slug}" som ${seenSlugs.get(slug)}`);
			seenSlugs.set(slug, p);
			if (!Array.isArray(w.exercises) || w.exercises.length === 0)
				return issues.add(`${p}.exercises`, 'måste vara en lista med minst en övning');
			const items: ImportWorkout['exercises'] = [];
			w.exercises.forEach((x, j) => {
				const q = `${p}.exercises[${j}]`;
				if (!isObject(x)) return issues.add(q, 'måste vara ett objekt');
				const exName = typeof x.name === 'string' ? x.name.trim() : '';
				if (!exName) issues.add(`${q}.name`, 'måste vara en icke-tom sträng');
				if (typeof x.sets !== 'number' || !Number.isInteger(x.sets) || x.sets < 1)
					issues.add(`${q}.sets`, 'måste vara ett heltal, minst 1');
				const target = validateTarget(x.target, issues, `${q}.target`);
				if (exName && target && typeof x.sets === 'number') items.push({ name: exName, sets: x.sets, target });
			});
			workouts.push({ name, exercises: items });
		});

	if (!issues.ok) throw new ValidationError('importfil', issues.list);
	return { exercises, workouts };
}

// --- planering ----------------------------------------------------------

export type ExercisePlan =
	| { action: 'create'; exercise: Exercise; addedLogEntries: number }
	| { action: 'update'; exercise: Exercise; version: string; addedLogEntries: number; changes: string[] }
	| { action: 'unchanged'; exercise: Exercise };

export type WorkoutPlan =
	| { action: 'create' | 'new-version'; workout: WorkoutTemplate }
	| { action: 'unchanged'; workout: WorkoutTemplate };

export interface ImportPlan {
	exercises: ExercisePlan[];
	workouts: WorkoutPlan[];
	warnings: string[];
}

function sameSets(a: LogEntry, b: LogEntry): boolean {
	return a.date === b.date && JSON.stringify(a.sets) === JSON.stringify(b.sets);
}

function sameWorkoutContent(a: Pick<WorkoutTemplate, 'name' | 'exercises'>, b: Pick<WorkoutTemplate, 'name' | 'exercises'>) {
	return a.name === b.name && JSON.stringify(a.exercises) === JSON.stringify(b.exercises);
}

export const IMPORT_CHANGE_NOTE = 'Import från Craft';

/**
 * Räknar ut vad importen skulle göra mot befintliga data. Skriver ingenting.
 * `today` (YYYY-MM-DD) blir `createdAt` på nya passversioner.
 */
export function planImport(
	input: ImportFile,
	existingExercises: StoredJson<Exercise>[],
	existingLatestWorkouts: WorkoutTemplate[],
	today: string
): ImportPlan {
	const warnings: string[] = [];
	const errors: string[] = [];

	const byName = new Map<string, Exercise>();
	for (const { data } of existingExercises) {
		const key = normalizeName(data.name);
		if (byName.has(key)) warnings.push(`Flera befintliga övningar heter "${data.name}", matchar mot ${byName.get(key)!.id}`);
		else byName.set(key, data);
	}
	const versions = new Map(existingExercises.map((e) => [e.data.id, e.version]));
	const takenIds = new Set(existingExercises.map((e) => e.data.id));

	const exercisePlans: ExercisePlan[] = [];
	for (const imp of input.exercises) {
		const existing = byName.get(normalizeName(imp.name));
		if (!existing) {
			let loadClass = imp.loadClass;
			if (imp.type === 'weight' && !loadClass) {
				loadClass = 'light';
				warnings.push(`"${imp.name}" saknar loadClass, sätter light (steg 1,25 kg)`);
			}
			const id = uniqueId(exerciseIdBase(imp.name), takenIds);
			takenIds.add(id);
			const exercise: Exercise = {
				id,
				name: imp.name,
				type: imp.type,
				...(loadClass ? { loadClass } : {}),
				instruction: imp.instruction,
				archived: false,
				log: sortLog(dedupeLog(imp.log))
			};
			byName.set(normalizeName(imp.name), exercise);
			exercisePlans.push({ action: 'create', exercise, addedLogEntries: exercise.log.length });
			continue;
		}

		if (existing.type !== imp.type) {
			errors.push(`"${imp.name}" är ${imp.type} i filen men ${existing.type} i appen (${existing.id})`);
			continue;
		}
		const changes: string[] = [];
		const updated: Exercise = { ...existing };
		if (!existing.instruction && imp.instruction) {
			updated.instruction = imp.instruction;
			changes.push('instruktion');
		}
		if (existing.type === 'weight' && !existing.loadClass && imp.loadClass) {
			updated.loadClass = imp.loadClass;
			changes.push('loadClass');
		}
		const newEntries = dedupeLog(imp.log).filter((e) => !existing.log.some((x) => sameSets(x, e)));
		if (newEntries.length) {
			updated.log = sortLog([...existing.log, ...newEntries]);
			changes.push(`${newEntries.length} loggposter`);
		}
		byName.set(normalizeName(imp.name), updated);
		exercisePlans.push(
			changes.length
				? { action: 'update', exercise: updated, version: versions.get(existing.id)!, addedLogEntries: newEntries.length, changes }
				: { action: 'unchanged', exercise: existing }
		);
	}

	const latestBySlug = new Map(existingLatestWorkouts.map((w) => [w.slug, w]));
	const workoutPlans: WorkoutPlan[] = [];
	for (const imp of input.workouts) {
		const slug = slugify(imp.name);
		const items: WorkoutExercise[] = [];
		for (const x of imp.exercises) {
			const exercise = byName.get(normalizeName(x.name));
			if (!exercise) {
				errors.push(`Passet "${imp.name}" använder "${x.name}", som varken finns i filen eller i appen`);
				continue;
			}
			if (!targetMatchesType(x.target, exercise.type)) {
				const want = exercise.type === 'time' ? 'seconds' : 'reps';
				errors.push(`Passet "${imp.name}": målet för "${x.name}" ska anges i ${want} (${exercise.type})`);
				continue;
			}
			items.push({ exerciseId: exercise.id, sets: x.sets, target: x.target });
		}
		const latest = latestBySlug.get(slug);
		if (latest && sameWorkoutContent(latest, { name: imp.name, exercises: items })) {
			workoutPlans.push({ action: 'unchanged', workout: latest });
			continue;
		}
		const workout: WorkoutTemplate = {
			slug,
			name: imp.name,
			version: (latest?.version ?? 0) + 1,
			createdAt: today,
			changeNote: IMPORT_CHANGE_NOTE,
			exercises: items
		};
		workoutPlans.push({ action: latest ? 'new-version' : 'create', workout });
	}

	if (errors.length) throw new ValidationError('import', errors);
	return { exercises: exercisePlans, workouts: workoutPlans, warnings };
}

/** Tar bort identiska dubbletter inom filen (samma datum och samma set). */
function dedupeLog(log: LogEntry[]): LogEntry[] {
	return log.filter((e, i) => log.findIndex((x) => sameSets(x, e)) === i);
}

// --- skrivning ----------------------------------------------------------

/**
 * Skriver planen. Övningar skrivs före pass, så ett pass aldrig pekar på en
 * övning som saknas. Nya filer skrivs med `createOnly` och ändrade med
 * `ifMatch`, så importen avbryts hellre än skriver över något som ändrats
 * sedan planen räknades ut.
 */
export async function applyImport(storage: UserStorage, plan: ImportPlan): Promise<void> {
	for (const p of plan.exercises) {
		if (p.action === 'create') {
			await storage.writeJson(`exercises/${p.exercise.id}.json`, p.exercise, { createOnly: true });
		} else if (p.action === 'update') {
			await saveExercise(storage, p.exercise, p.version);
		}
	}
	for (const p of plan.workouts) {
		if (p.action === 'unchanged') continue;
		await storage.writeJson(`workouts/${workoutFileName(p.workout.slug, p.workout.version)}`, p.workout, {
			createOnly: true
		});
	}
}

/** Läser befintliga data och räknar ut planen. */
export async function planImportFor(storage: UserStorage, input: ImportFile, today: string): Promise<ImportPlan> {
	const [exercises, workouts] = await Promise.all([listExercises(storage), listLatestWorkouts(storage)]);
	return planImport(input, exercises, workouts, today);
}

export function summarizePlan(plan: ImportPlan): string {
	const lines: string[] = [];
	for (const p of plan.exercises) {
		const e = p.exercise;
		if (p.action === 'create') lines.push(`+ övning ${e.id} "${e.name}" (${e.type}, ${p.addedLogEntries} loggposter)`);
		else if (p.action === 'update') lines.push(`~ övning ${e.id} "${e.name}": ${p.changes.join(', ')}`);
		else lines.push(`= övning ${e.id} "${e.name}" oförändrad`);
	}
	for (const p of plan.workouts) {
		const w = p.workout;
		const file = workoutFileName(w.slug, w.version);
		if (p.action === 'create') lines.push(`+ pass ${file} "${w.name}" (${w.exercises.length} övningar)`);
		else if (p.action === 'new-version') lines.push(`~ pass ${file} "${w.name}": ny version`);
		else lines.push(`= pass ${file} "${w.name}" oförändrat`);
	}
	for (const w of plan.warnings) lines.push(`! ${w}`);
	return lines.join('\n');
}
