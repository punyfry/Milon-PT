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
	const all = await Promise.all(ids.map((id) => getSession(storage, id)));
	return all
		.filter((s) => s !== null)
		.map((s) => s.data)
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Ett sparat pass skrivs en gång och ändras inte. */
export async function createSession(storage: UserStorage, session: SessionRecord): Promise<SessionRecord> {
	const valid = assertValid('pass', session, validateSession);
	await storage.writeJson(path(valid.id), valid, { createOnly: true });
	return valid;
}
