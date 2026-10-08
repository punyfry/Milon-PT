/**
 * One-off import from Craft (see README.md, "Craft import").
 *
 * The flow is split so it can be dry-run and tested:
 * 1. `parseImportFile` validates the whole file and collects all errors.
 * 2. `planImport` compares against existing data and works out what to
 *    create or change, without writing anything.
 * 3. `applyImport` writes the plan through the storage interface.
 *
 * Exercise names are matched against existing exercises (ignoring case and
 * whitespace) before new ones are created. Besides exercises and workouts the
 * file may contain a profile (goals, rules, kcal per workout type), notes on
 * log entries, archived exercises and completed sessions (`sessions`), which
 * become session records with that day's log entries linked. The import can
 * be rerun with the same file: identical log entries, workouts and sessions
 * are skipped, and existing profile values are never overwritten.
 */
import {
	Issues,
	ValidationError,
	exerciseIdBase,
	isCalendarDate,
	isExerciseType,
	isObject,
	normalizeName,
	sessionIdFor,
	slugify,
	targetMatchesType,
	uniqueId,
	validateKcalEstimates,
	validateLogEntry,
	validateTarget,
	workoutFileName,
	type Exercise,
	type ExerciseType,
	type LogEntry,
	type Profile,
	type SessionRecord,
	type Target,
	type WorkoutExercise,
	type WorkoutTemplate
} from '../../model';
import { stockholmOffset } from '../../time';
import { listExercises, saveExercise, sortLog } from '../data/exercises';
import { getProfile, saveProfile } from '../data/profile';
import { createSession, listSessions } from '../data/sessions';
import { listLatestWorkouts } from '../data/workouts';
import type { StoredJson, UserStorage } from '../storage/types';

// --- file format --------------------------------------------------------

export interface ImportExercise {
	name: string;
	type: ExerciseType;
	instruction: string;
	archived: boolean;
	log: LogEntry[];
}

export interface ImportProfile {
	goals?: string;
	rules?: string[];
	kcalEstimates?: Profile['kcalEstimates'];
	weeklySessionGoal?: number;
}

/** A completed session from Craft: date, workout name and optional kcal. */
export interface ImportSession {
	date: string;
	workout: string;
	kcalEstimate?: number;
}

export interface ImportWorkout {
	name: string;
	exercises: { name: string; sets: number; target: Target }[];
}

export interface ImportFile {
	profile?: ImportProfile;
	exercises: ImportExercise[];
	workouts: ImportWorkout[];
	sessions: ImportSession[];
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
			if (e.instruction !== undefined && typeof e.instruction !== 'string')
				issues.add(`${p}.instruction`, 'måste vara en sträng');
			const rawLog = e.log ?? [];
			if (!Array.isArray(rawLog)) return issues.add(`${p}.log`, 'måste vara en lista');
			const log = rawLog.map((entry, j) => validateLogEntry(entry, e.type as ExerciseType, issues, `${p}.log[${j}]`));
			exercises.push({
				name,
				type: e.type,
				instruction: typeof e.instruction === 'string' ? e.instruction.trim() : '',
				archived: e.archived === true,
				log: log.filter((l) => l !== null)
			});
			if (e.archived !== undefined && typeof e.archived !== 'boolean') issues.add(`${p}.archived`, 'måste vara true eller false');
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

	const profile = raw.profile === undefined ? undefined : parseProfile(raw.profile, issues);

	const sessions: ImportSession[] = [];
	const rawSessions = raw.sessions ?? [];
	if (!Array.isArray(rawSessions)) issues.add('sessions', 'måste vara en lista');
	else
		rawSessions.forEach((s, i) => {
			const p = `sessions[${i}]`;
			if (!isObject(s)) return issues.add(p, 'måste vara ett objekt');
			const date = typeof s.date === 'string' && isCalendarDate(s.date) ? s.date : null;
			if (!date) issues.add(`${p}.date`, 'måste vara ett datum YYYY-MM-DD');
			const workout = typeof s.workout === 'string' ? s.workout.trim() : '';
			if (!workout) issues.add(`${p}.workout`, 'måste vara passets namn');
			const kcal = s.kcalEstimate;
			if (kcal !== undefined && (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal < 0 || kcal > 5000))
				issues.add(`${p}.kcalEstimate`, 'måste vara ett tal mellan 0 och 5000');
			if (date && workout) sessions.push({ date, workout, ...(typeof kcal === 'number' ? { kcalEstimate: Math.round(kcal) } : {}) });
		});

	if (!issues.ok) throw new ValidationError('importfil', issues.list);
	return { ...(profile ? { profile } : {}), exercises, workouts, sessions };
}

/** Profile from Craft: goals as text or list, rules, kcalEstimates and weekly goal. */
function parseProfile(v: unknown, issues: Issues): ImportProfile | undefined {
	if (!isObject(v)) {
		issues.add('profile', 'måste vara ett objekt');
		return undefined;
	}
	const out: ImportProfile = {};
	if (typeof v.goals === 'string') {
		if (v.goals.trim()) out.goals = v.goals.trim();
	} else if (Array.isArray(v.goals)) {
		if (!v.goals.every((g) => typeof g === 'string')) issues.add('profile.goals', 'måste vara text eller en lista med text');
		else {
			const goals = (v.goals as string[]).map((g) => g.trim()).filter(Boolean);
			if (goals.length) out.goals = goals.map((g) => `- ${g}`).join('\n');
		}
	} else if (v.goals !== undefined) issues.add('profile.goals', 'måste vara text eller en lista med text');

	if (v.rules !== undefined) {
		if (!Array.isArray(v.rules) || !v.rules.every((r) => typeof r === 'string')) issues.add('profile.rules', 'måste vara en lista med text');
		else out.rules = (v.rules as string[]).map((r) => r.trim()).filter(Boolean);
	}
	if (v.kcalEstimates !== undefined) {
		const k = validateKcalEstimates(v.kcalEstimates, issues, 'profile.kcalEstimates');
		if (k) out.kcalEstimates = k;
	}
	if (v.weeklySessionGoal !== undefined) {
		const g = v.weeklySessionGoal;
		if (typeof g !== 'number' || !Number.isInteger(g) || g < 0 || g > 14) issues.add('profile.weeklySessionGoal', 'måste vara ett heltal 0-14');
		else if (g > 0) out.weeklySessionGoal = g;
	}
	return out;
}

// --- planning -----------------------------------------------------------

export type ExercisePlan =
	| { action: 'create'; exercise: Exercise; addedLogEntries: number }
	| { action: 'update'; exercise: Exercise; version: string; addedLogEntries: number; changes: string[] }
	| { action: 'unchanged'; exercise: Exercise };

export type WorkoutPlan =
	| { action: 'create' | 'new-version'; workout: WorkoutTemplate }
	| { action: 'unchanged'; workout: WorkoutTemplate };

export type ProfilePlan =
	| { action: 'create' | 'update'; profile: Profile; version?: string; changes: string[] }
	| { action: 'unchanged'; profile: Profile };

export type SessionPlan = { action: 'create' | 'unchanged'; session: SessionRecord };

export interface ImportPlan {
	profile: ProfilePlan;
	exercises: ExercisePlan[];
	workouts: WorkoutPlan[];
	sessions: SessionPlan[];
	warnings: string[];
}

/** What the user already has. */
export interface ExistingData {
	exercises: StoredJson<Exercise>[];
	latestWorkouts: WorkoutTemplate[];
	sessions: SessionRecord[];
	profile: { data: Profile; version?: string };
}

function sameSets(a: LogEntry, b: LogEntry): boolean {
	return a.date === b.date && JSON.stringify(a.sets) === JSON.stringify(b.sets);
}

function sameWorkoutContent(a: Pick<WorkoutTemplate, 'name' | 'exercises'>, b: Pick<WorkoutTemplate, 'name' | 'exercises'>) {
	return a.name === b.name && JSON.stringify(a.exercises) === JSON.stringify(b.exercises);
}

export const IMPORT_CHANGE_NOTE = 'Import från Craft';

/** Imported sessions have no time of day; they are placed at noon Stockholm time. */
export function importedStartTime(date: string): string {
	return `${date}T12:00:00${stockholmOffset(date)}`;
}

/**
 * Works out what the import would do against existing data. Writes nothing.
 * `today` (YYYY-MM-DD) becomes `createdAt` on new workout versions.
 */
export function planImport(input: ImportFile, existing: ExistingData, today: string): ImportPlan {
	const warnings: string[] = [];
	const errors: string[] = [];

	// 1. Session id per date, so log entries can be linked to their sessions.
	const takenSessionIds = new Set(existing.sessions.map((s) => s.id));
	const sessionIdByDate = new Map<string, string>();
	const sessionDrafts: { id: string; slug: string; startedAt: string; imp: ImportSession; existing?: SessionRecord }[] = [];
	for (const imp of [...input.sessions].sort((a, b) => a.date.localeCompare(b.date))) {
		const slug = slugify(imp.workout);
		const startedAt = importedStartTime(imp.date);
		// The same workout on the same day counts as the same session, even if logged in the app.
		const same = existing.sessions.find((s) => s.startedAt.slice(0, 10) === imp.date && s.workoutSlug === slug);
		const id = same?.id ?? sessionIdFor(imp.date, takenSessionIds);
		takenSessionIds.add(id);
		if (sessionIdByDate.has(imp.date)) warnings.push(`Flera pass ${imp.date}: loggposterna kopplas till det första`);
		else sessionIdByDate.set(imp.date, id);
		sessionDrafts.push({ id, slug, startedAt, imp, ...(same ? { existing: same } : {}) });
	}
	// Log entries only get session ids from the import's own sessions, never
	// from the file, so no entry points to a session that doesn't exist.
	const withSession = ({ date, sets, note }: LogEntry): LogEntry => {
		const sessionId = sessionIdByDate.get(date);
		return { ...(sessionId ? { sessionId } : {}), date, sets, ...(note !== undefined ? { note } : {}) };
	};

	// 2. Exercises.
	const byName = new Map<string, Exercise>();
	for (const { data } of existing.exercises) {
		const key = normalizeName(data.name);
		if (byName.has(key)) warnings.push(`Flera befintliga övningar heter "${data.name}", matchar mot ${byName.get(key)!.id}`);
		else byName.set(key, data);
	}
	const versions = new Map(existing.exercises.map((e) => [e.data.id, e.version]));
	const takenIds = new Set(existing.exercises.map((e) => e.data.id));

	const exercisePlans: ExercisePlan[] = [];
	for (const imp of input.exercises) {
		const current = byName.get(normalizeName(imp.name));
		const entries = dedupeLog(imp.log.map(withSession));
		if (!current) {
			const id = uniqueId(exerciseIdBase(imp.name), takenIds);
			takenIds.add(id);
			const exercise: Exercise = {
				id,
				name: imp.name,
				type: imp.type,
				instruction: imp.instruction,
				archived: imp.archived,
				log: sortLog(entries)
			};
			byName.set(normalizeName(imp.name), exercise);
			exercisePlans.push({ action: 'create', exercise, addedLogEntries: exercise.log.length });
			continue;
		}

		if (current.type !== imp.type) {
			errors.push(`"${imp.name}" är ${imp.type} i filen men ${current.type} i appen (${current.id})`);
			continue;
		}
		const changes: string[] = [];
		const updated: Exercise = { ...current, log: current.log.map((e) => ({ ...e })) };
		if (!current.instruction && imp.instruction) {
			updated.instruction = imp.instruction;
			changes.push('instruktion');
		}
		if (imp.archived && !current.archived) {
			updated.archived = true;
			changes.push('arkiverad');
		}
		// New entries are added; existing identical entries get a note and session link if missing.
		let added = 0;
		let enriched = 0;
		for (const e of entries) {
			const match = updated.log.find((x) => sameSets(x, e));
			if (!match) {
				updated.log.push(e);
				added++;
				continue;
			}
			let touched = false;
			if (!match.note && e.note) {
				match.note = e.note;
				touched = true;
			}
			if (!match.sessionId && e.sessionId) {
				match.sessionId = e.sessionId;
				touched = true;
			}
			if (touched) enriched++;
		}
		if (added || enriched) updated.log = sortLog(updated.log);
		if (added) changes.push(`${added} loggposter`);
		if (enriched) changes.push(`${enriched} loggposter kompletterade`);
		byName.set(normalizeName(imp.name), updated);
		exercisePlans.push(
			changes.length
				? { action: 'update', exercise: updated, version: versions.get(current.id)!, addedLogEntries: added, changes }
				: { action: 'unchanged', exercise: current }
		);
	}

	// 3. Workouts.
	const latestBySlug = new Map(existing.latestWorkouts.map((w) => [w.slug, w]));
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

	// 4. Completed sessions.
	const versionBySlug = new Map(existing.latestWorkouts.map((w) => [w.slug, w.version]));
	for (const p of workoutPlans) versionBySlug.set(p.workout.slug, p.workout.version);
	const plannedExercises = exercisePlans.map((p) => p.exercise);
	const sessionPlans: SessionPlan[] = [];
	for (const d of sessionDrafts) {
		if (d.existing) {
			sessionPlans.push({ action: 'unchanged', session: d.existing });
			continue;
		}
		const version = versionBySlug.get(d.slug);
		if (!version) {
			errors.push(`Passet ${d.imp.date} ("${d.imp.workout}") finns varken i filen eller i appen`);
			continue;
		}
		const exerciseIds = plannedExercises.filter((e) => e.log.some((l) => l.sessionId === d.id)).map((e) => e.id);
		if (!exerciseIds.length) warnings.push(`Passet ${d.imp.date} ("${d.imp.workout}") har inga loggade övningar`);
		sessionPlans.push({
			action: 'create',
			session: {
				id: d.id,
				workoutSlug: d.slug,
				workoutVersion: version,
				startedAt: d.startedAt,
				endedAt: d.startedAt,
				exerciseIds,
				deviations: [],
				...(d.imp.kcalEstimate !== undefined ? { kcalEstimate: d.imp.kcalEstimate } : {})
			}
		});
	}

	// 5. Profile: only fill in what's missing; rules are appended.
	const current = existing.profile.data;
	const next: Profile = { ...current };
	const profileChanges: string[] = [];
	const imp = input.profile;
	if (imp?.goals && !current.goals?.trim()) {
		next.goals = imp.goals;
		profileChanges.push('mål');
	}
	const newRules = (imp?.rules ?? []).filter((r) => !(current.rules ?? []).includes(r));
	if (newRules.length) {
		next.rules = [...(current.rules ?? []), ...newRules];
		profileChanges.push(`${newRules.length} regler`);
	}
	for (const [type, range] of Object.entries(imp?.kcalEstimates ?? {})) {
		if (range && !current.kcalEstimates?.[type as keyof NonNullable<Profile['kcalEstimates']>]) {
			next.kcalEstimates = { ...next.kcalEstimates, [type]: range };
			profileChanges.push(`kcal för ${type === 'hiit' ? 'HIIT' : 'styrka'}`);
		}
	}
	if (imp?.weeklySessionGoal && !current.weeklySessionGoal) {
		next.weeklySessionGoal = imp.weeklySessionGoal;
		profileChanges.push('veckomål');
	}
	const profilePlan: ProfilePlan = profileChanges.length
		? {
				action: existing.profile.version ? 'update' : 'create',
				profile: next,
				...(existing.profile.version ? { version: existing.profile.version } : {}),
				changes: profileChanges
			}
		: { action: 'unchanged', profile: current };

	if (errors.length) throw new ValidationError('import', errors);
	return { profile: profilePlan, exercises: exercisePlans, workouts: workoutPlans, sessions: sessionPlans, warnings };
}

/** Removes identical duplicates within the file (same date and same sets). */
function dedupeLog(log: LogEntry[]): LogEntry[] {
	return log.filter((e, i) => log.findIndex((x) => sameSets(x, e)) === i);
}

// --- writing ------------------------------------------------------------

/**
 * Writes the plan. Sessions first, then exercises before workouts, so a
 * workout never points to a missing exercise. New files are written with
 * `createOnly` and changed ones with `ifMatch`, so the import aborts rather
 * than overwrite anything changed since the plan was made.
 */
export async function applyImport(storage: UserStorage, plan: ImportPlan): Promise<void> {
	// Session records first: if the import aborts after them, no log entry
	// points to a missing session (the app treats such an entry as already saved).
	for (const p of plan.sessions) {
		if (p.action === 'create') await createSession(storage, p.session);
	}
	if (plan.profile.action !== 'unchanged') await saveProfile(storage, plan.profile.profile, plan.profile.version);
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

/** Number of files that would be written. */
export function countWrites(plan: ImportPlan): number {
	return (
		(plan.profile.action === 'unchanged' ? 0 : 1) +
		plan.exercises.filter((p) => p.action !== 'unchanged').length +
		plan.workouts.filter((p) => p.action !== 'unchanged').length +
		plan.sessions.filter((p) => p.action === 'create').length
	);
}

/** Reads existing data and works out the plan. */
export async function planImportFor(storage: UserStorage, input: ImportFile, today: string): Promise<ImportPlan> {
	const [exercises, latestWorkouts, sessions, profile] = await Promise.all([
		listExercises(storage),
		listLatestWorkouts(storage),
		listSessions(storage),
		getProfile(storage)
	]);
	return planImport(input, { exercises, latestWorkouts, sessions, profile }, today);
}

export function summarizePlan(plan: ImportPlan): string {
	const lines: string[] = [];
	if (plan.profile.action === 'unchanged') lines.push('= profil oförändrad');
	else lines.push(`${plan.profile.action === 'create' ? '+' : '~'} profil: ${plan.profile.changes.join(', ')}`);
	for (const p of plan.exercises) {
		const e = p.exercise;
		if (p.action === 'create') lines.push(`+ övning ${e.id} "${e.name}" (${e.type}, ${p.addedLogEntries} loggposter)${e.archived ? ", arkiverad" : ""}`);
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
	for (const p of plan.sessions) {
		const se = p.session;
		const kcal = se.kcalEstimate !== undefined ? `, ${se.kcalEstimate} kcal` : '';
		lines.push(
			p.action === 'create'
				? `+ genomfört pass ${se.startedAt.slice(0, 10)} ${se.workoutSlug} (${se.id}, ${se.exerciseIds.length} övningar${kcal})`
				: `= genomfört pass ${se.startedAt.slice(0, 10)} redan sparat (${se.id})`
		);
	}
	for (const w of plan.warnings) lines.push(`! ${w}`);
	return lines.join('\n');
}
