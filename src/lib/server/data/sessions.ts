import { assertValid, validateSession, type SessionRecord } from '../../model';
import type { StoredJson, UserStorage } from '../storage/types';

const DIR = 'sessions/';
const path = (id: string) => `${DIR}${id}.json`;

export async function getSession(storage: UserStorage, id: string): Promise<StoredJson<SessionRecord> | null> {
	const file = await storage.readJson<unknown>(path(id));
	if (!file) return null;
	return { data: assertValid(`pass ${id}`, file.data, validateSession), version: file.version };
}

export async function listSessionIds(storage: UserStorage): Promise<string[]> {
	const files = await storage.list(DIR);
	return files
		.map((f) => f.path.slice(DIR.length))
		.filter((name) => name.endsWith('.json') && !name.includes('/'))
		.map((name) => name.slice(0, -'.json'.length));
}

export async function listSessions(storage: UserStorage): Promise<SessionRecord[]> {
	const ids = await listSessionIds(storage);
	return (await readSessions(storage, ids)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Datumet i ett sessions-id (`s_YYYYMMDD` eller `s_YYYYMMDD_2`), annars null. */
function idDate(id: string): string | null {
	const m = /^s_(\d{4})(\d{2})(\d{2})(_\d+)?$/.exec(id);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function readSessions(storage: UserStorage, ids: readonly string[]): Promise<SessionRecord[]> {
	const all = await Promise.all(ids.map((id) => getSession(storage, id)));
	return all.filter((s) => s !== null).map((s) => s.data);
}

/**
 * Pass som startade från och med `from` till (inte med) `to`, YYYY-MM-DD.
 * Läser bara filerna vars id ligger i intervallet (och id:n utan datum).
 */
export async function listSessionsBetween(storage: UserStorage, from: string, to: string): Promise<SessionRecord[]> {
	const ids = (await listSessionIds(storage)).filter((id) => {
		const d = idDate(id);
		return d === null || (d >= from && d < to);
	});
	return (await readSessions(storage, ids))
		.filter((s) => s.startedAt.slice(0, 10) >= from && s.startedAt.slice(0, 10) < to)
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * Senaste starttiden per pass (slug). Läser nyaste filerna först, i omgångar
 * som fördubblas (10, 20, 40 …), och slutar när alla `slugs` har hittats.
 */
export async function lastSessionBySlug(storage: UserStorage, slugs: readonly string[]): Promise<Map<string, string>> {
	const ids = (await listSessionIds(storage)).sort(
		(a, b) => (idDate(b) ?? '9999').localeCompare(idDate(a) ?? '9999') || b.localeCompare(a)
	);
	const wanted = new Set(slugs);
	const last = new Map<string, string>();
	for (let i = 0, batch = 10; i < ids.length; i += batch, batch *= 2) {
		const end = Math.min(i + batch, ids.length);
		for (const s of await readSessions(storage, ids.slice(i, end))) {
			const prev = last.get(s.workoutSlug);
			if (!prev || Date.parse(s.startedAt) > Date.parse(prev)) last.set(s.workoutSlug, s.startedAt);
		}
		// Ett id säger bara datumet, så läs klart dagen innan vi slutar.
		const nextDate = end < ids.length ? idDate(ids[end]) : null;
		if ([...wanted].every((slug) => last.has(slug)) && (nextDate === null || nextDate !== idDate(ids[end - 1]))) break;
	}
	return last;
}

/** Ett sparat pass skrivs en gång och ändras inte. */
export async function createSession(storage: UserStorage, session: SessionRecord): Promise<SessionRecord> {
	const valid = assertValid('pass', session, validateSession);
	await storage.writeJson(path(valid.id), valid, { createOnly: true });
	return valid;
}
