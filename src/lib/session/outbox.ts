/**
 * Sessions that could not be saved because the network was down. They stay
 * in localStorage and are resent when the network comes back. The server
 * recognises a session that is already saved (same id and start time), so a
 * retry can never create duplicates.
 */
const KEY = 'milonpt.pendingSaves';
/** Dispatched on window when the queue changes, so the panel updates right away. */
export const OUTBOX_EVENT = 'milonpt-outbox';

export interface PendingSave {
	/** Unique per session: session id plus start time (the id is only the date). */
	key: string;
	/** The account the session belongs to; only sent when that account is logged in. */
	userId: string;
	workoutName: string;
	/** The body sent to POST /api/sessions. */
	body: unknown;
	/** Latest error from the server, if it responded with one. */
	error?: string;
}

export const pendingKey = (sessionId: string, startedAt: string) => `${sessionId}|${startedAt}`;

function readAll(): PendingSave[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(parsed) ? (parsed as PendingSave[]).filter((p) => typeof p?.key === 'string') : [];
	} catch {
		return [];
	}
}

/** Queued sessions for the account. */
export function pendingSaves(userId: string | null): PendingSave[] {
	return userId ? readAll().filter((p) => p.userId === userId) : [];
}

function write(list: PendingSave[]): boolean {
	try {
		if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
		else localStorage.removeItem(KEY);
		if (typeof dispatchEvent === 'function') dispatchEvent(new Event(OUTBOX_EVENT));
		return true;
	} catch {
		return false;
	}
}

/** Queues the session. Returns false if localStorage cannot be written. */
export function queueSave(save: PendingSave): boolean {
	return write([...readAll().filter((p) => p.key !== save.key), save]);
}

/** An error caused by the network (not the server). */
export function isNetworkError(e: unknown): boolean {
	return e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

let flushing: Promise<PendingSave[]> | null = null;

/** Runs `fn` under a lock across all tabs when the browser supports it. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	return locks ? locks.request('milonpt-outbox', fn) : fn();
}

/**
 * Tries to send the account's queued sessions and returns what remains. A
 * network error aborts the attempt; a server error is stored on the entry so
 * it can be shown.
 */
export function flushPendingSaves(userId: string | null, fetcher: typeof fetch = fetch): Promise<PendingSave[]> {
	flushing ??= withLock(async () => {
		for (const item of pendingSaves(userId)) {
			let res: Response;
			try {
				res = await fetcher('/api/sessions', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(item.body)
				});
			} catch {
				break;
			}
			const rest = readAll().filter((p) => p.key !== item.key);
			if (res.ok) write(rest);
			else {
				const body = await res.json().catch(() => null);
				const error = res.status === 401 ? 'Logga in igen för att spara' : (body?.message ?? `Servern svarade ${res.status}`);
				write([...rest, { ...item, error }]);
			}
		}
		return pendingSaves(userId);
	}).finally(() => {
		flushing = null;
	});
	return flushing;
}

export function discardPendingSave(key: string): void {
	write(readAll().filter((p) => p.key !== key));
}
