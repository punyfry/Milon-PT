/**
 * Pass som inte kunde sparas för att nätet saknades. De ligger i
 * localStorage och skickas igen när nätet kommer tillbaka. Servern känner
 * igen ett pass som redan sparats (samma id och starttid), så ett nytt
 * försök kan aldrig ge dubbletter.
 */
const KEY = 'milonpt.pendingSaves';
/** Skickas på window när kön ändras, så att rutan uppdateras direkt. */
export const OUTBOX_EVENT = 'milonpt-outbox';

export interface PendingSave {
	/** Unik per pass: sessions-id plus starttid (id:t är bara datumet). */
	key: string;
	/** Kontot passet tillhör; skickas bara när samma konto är inloggat. */
	userId: string;
	workoutName: string;
	/** Det som skickas till POST /api/sessions. */
	body: unknown;
	/** Senaste felet från servern, om den svarat med fel. */
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

/** Köade pass för kontot. */
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

/** Lägger passet i kön. Ger false om localStorage inte går att skriva. */
export function queueSave(save: PendingSave): boolean {
	return write([...readAll().filter((p) => p.key !== save.key), save]);
}

/** Ett fel som beror på nätet (inte på servern). */
export function isNetworkError(e: unknown): boolean {
	return e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

let flushing: Promise<PendingSave[]> | null = null;

/** Kör `fn` med ett lås över alla flikar när webbläsaren stöder det. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	return locks ? locks.request('milonpt-outbox', fn) : fn();
}

/**
 * Försöker skicka kontots köade pass. Returnerar det som ligger kvar. Ett
 * nätfel avbryter försöket; ett fel från servern sparas på posten så att
 * det kan visas.
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
