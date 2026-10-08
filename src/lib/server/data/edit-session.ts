/**
 * A saved session afterwards: read it with its sets, correct sets and times,
 * remove an exercise from it, or delete it.
 *
 * A session is stored in two places: the record (`sessions/<id>.json`, times
 * and which exercises were done) and one log entry per exercise (the sets,
 * linked by `sessionId`). Edits write the log entries first and the record
 * last, guarded by the record's version, so a failed save can simply be
 * retried and a stale page gets a conflict instead of overwriting.
 */
import {
	Issues,
	ValidationError,
	isObject,
	validateSet,
	type ExerciseSet,
	type ExerciseType,
	type LoadClass,
	type LogEntry,
	type SessionRecord
} from '../../model';
import { stockholmIso } from '../../time';
import { StorageConflictError, type UserStorage } from '../storage/types';
import { getExercise, saveExercise, sortLog } from './exercises';
import { deleteSessionRecord, getSession, saveSessionRecord } from './sessions';
import { getWorkout } from './workouts';

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)$/;
/** Upper bounds for typed values, so a typo like 6000 kg is caught. */
const MAX = { weight: 1000, reps: 1000, seconds: 6 * 3600 };

export interface SessionDetail {
	session: SessionRecord;
	/** Version of the record, sent back with an edit or delete. */
	version: string;
	workoutName: string;
	exercises: { id: string; name: string; type: ExerciseType; loadClass?: LoadClass; sets: ExerciseSet[]; note?: string }[];
}

export async function getSessionDetail(storage: UserStorage, id: string): Promise<SessionDetail | null> {
	if (!ID.test(id)) return null;
	const stored = await getSession(storage, id);
	if (!stored) return null;
	const session = stored.data;
	const [workout, ...exercises] = await Promise.all([
		getWorkout(storage, session.workoutSlug, session.workoutVersion),
		...session.exerciseIds.map((e) => getExercise(storage, e))
	]);
	return {
		session,
		version: stored.version,
		workoutName: workout?.data.name ?? session.workoutSlug,
		exercises: exercises.flatMap((e) => {
			const entry = e?.data.log.find((l) => l.sessionId === id);
			if (!e || !entry) return [];
			const { id: exId, name, type, loadClass } = e.data;
			return [{ id: exId, name, type, ...(loadClass ? { loadClass } : {}), sets: entry.sets, ...(entry.note ? { note: entry.note } : {}) }];
		})
	};
}

export interface EditSessionInput {
	version: string;
	/** Start time of day, HH:MM. The start date can't change (it is part of the session id). */
	startTime: string;
	/** End as YYYY-MM-DDTHH:MM, Stockholm time. */
	end: string;
	kcalEstimate: number | null;
	/** The exercises to keep, with their sets. Exercises left out are removed from the session. */
	exercises: { exerciseId: string; sets: unknown[] }[];
}

/** Shape check before anything is read. The sets are checked against each exercise's type in `editSession`. */
export function parseEditSessionInput(raw: unknown): EditSessionInput {
	const issues: string[] = [];
	if (!isObject(raw)) throw new ValidationError('ändring', ['måste vara ett objekt']);
	if (typeof raw.version !== 'string' || !raw.version || raw.version.length > 200) issues.push('Versionen saknas. Ladda om sidan.');
	if (typeof raw.startTime !== 'string' || !TIME.test(raw.startTime)) issues.push('Ange en starttid.');
	if (typeof raw.end !== 'string' || !DATE_TIME.test(raw.end)) issues.push('Ange en sluttid med datum och klockslag.');
	const kcal = raw.kcalEstimate;
	if (kcal !== null && (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal < 0 || kcal > 5000)) issues.push('Kcal ska vara mellan 0 och 5000.');
	const exercises = Array.isArray(raw.exercises) ? raw.exercises : [];
	if (!Array.isArray(raw.exercises) || exercises.length < 1 || exercises.length > 50) issues.push('Passet måste ha minst en övning.');
	const seen = new Set<string>();
	exercises.forEach((e, i) => {
		if (!isObject(e) || typeof e.exerciseId !== 'string' || !ID.test(e.exerciseId) || seen.has(e.exerciseId)) {
			issues.push(`exercises[${i}] är ogiltig.`);
			return;
		}
		seen.add(e.exerciseId);
		if (!Array.isArray(e.sets) || e.sets.length < 1 || e.sets.length > 50) issues.push(`Varje övning måste ha minst ett set (exercises[${i}]).`);
	});
	if (issues.length) throw new ValidationError('ändring', issues);
	const input = raw as unknown as EditSessionInput;
	return { ...input, kcalEstimate: input.kcalEstimate === null ? null : Math.round(input.kcalEstimate) };
}

/** Same instant as before if the wall time is unchanged, so an untouched time keeps its exact value. */
function withTime(original: string, date: string, time: string): string {
	if (original.slice(0, 16) === `${date}T${time}`) return original;
	return stockholmIso(date, time);
}

/** Changes one exercise's log; retried on conflict since the read is fresh each time. */
async function updateLog(storage: UserStorage, exerciseId: string, change: (log: LogEntry[]) => LogEntry[] | null): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getExercise(storage, exerciseId);
		if (!current) return;
		const log = change(current.data.log);
		if (!log) return;
		try {
			await saveExercise(storage, { ...current.data, log }, current.version);
			return;
		} catch (e) {
			if (!(e instanceof StorageConflictError)) throw e;
		}
	}
	throw new StorageConflictError(`exercises/${exerciseId}.json`);
}

/** Returns the updated record, or null if the session doesn't exist. */
export async function editSession(storage: UserStorage, id: string, input: EditSessionInput, now = new Date()): Promise<SessionRecord | null> {
	if (!ID.test(id)) return null;
	const current = await getSession(storage, id);
	if (!current) return null;
	if (current.version !== input.version) throw new StorageConflictError(`sessions/${id}.json`);
	const record = current.data;

	// Times: the start date stays, the end may be on a later day.
	const startDate = record.startedAt.slice(0, 10);
	const [, endDate, endTime] = DATE_TIME.exec(input.end)!;
	const startedAt = withTime(record.startedAt, startDate, input.startTime);
	const endedAt = withTime(record.endedAt, endDate, endTime);
	const issues = new Issues();
	if (Date.parse(endedAt) <= Date.parse(startedAt)) issues.add('', 'Sluttiden måste vara efter starttiden.');
	if (Date.parse(endedAt) > now.getTime() + 60 * 60_000) issues.add('', 'Sluttiden kan inte vara i framtiden.');

	// Sets, checked against each exercise's type.
	const inSession = new Set(record.exerciseIds);
	const kept = new Map<string, ExerciseSet[]>();
	for (const [i, e] of input.exercises.entries()) {
		if (!inSession.has(e.exerciseId)) {
			issues.add(`exercises[${i}]`, `${e.exerciseId} ingår inte i passet`);
			continue;
		}
		const stored = await getExercise(storage, e.exerciseId);
		if (!stored) {
			issues.add(`exercises[${i}]`, `övningen ${e.exerciseId} finns inte`);
			continue;
		}
		const sets = e.sets.map((s, j) => {
			const path = `exercises[${i}].sets[${j}]`;
			const set = validateSet(s, stored.data.type, issues, path);
			if (set && Object.entries(set).some(([k, v]) => v > MAX[k as keyof typeof MAX])) issues.add(path, 'Orimligt högt värde.');
			return set;
		});
		kept.set(e.exerciseId, sets.filter((s) => s !== null));
	}
	if (!issues.ok) throw new ValidationError('ändring', issues.list);

	// Logs first: changed sets replace the entry, removed exercises lose it.
	for (const exerciseId of record.exerciseIds) {
		const sets = kept.get(exerciseId);
		await updateLog(storage, exerciseId, (log) => {
			const i = log.findIndex((l) => l.sessionId === id);
			if (!sets) return i < 0 ? null : log.filter((l) => l.sessionId !== id);
			if (i < 0) return sortLog([{ sessionId: id, date: startDate, sets }, ...log]);
			if (JSON.stringify(log[i].sets) === JSON.stringify(sets)) return null;
			return log.map((l, j) => (j === i ? { ...l, sets } : l));
		});
	}

	const updated: SessionRecord = { ...record, startedAt, endedAt, exerciseIds: record.exerciseIds.filter((e) => kept.has(e)) };
	if (startedAt !== record.startedAt) updated.originalStartedAt = record.originalStartedAt ?? record.startedAt;
	if (input.kcalEstimate === null) delete updated.kcalEstimate;
	else updated.kcalEstimate = input.kcalEstimate;
	return (await saveSessionRecord(storage, updated, current.version)).data;
}

/** Deletes the session and its log entries. Returns false if it doesn't exist. Workout versions it created stay. */
export async function deleteSession(storage: UserStorage, id: string, version: string): Promise<boolean> {
	if (!ID.test(id)) return false;
	const current = await getSession(storage, id);
	if (!current) return false;
	if (current.version !== version) throw new StorageConflictError(`sessions/${id}.json`);
	// Logs first, the record last: if something fails, the session is still there to delete again.
	for (const exerciseId of current.data.exerciseIds) {
		await updateLog(storage, exerciseId, (log) => (log.some((l) => l.sessionId === id) ? log.filter((l) => l.sessionId !== id) : null));
	}
	await deleteSessionRecord(storage, id);
	return true;
}
