/**
 * Pass som inte kunde sparas för att nätet saknades. De ligger i
 * localStorage och skickas igen när nätet kommer tillbaka. Servern känner
 * igen ett pass som redan sparats (samma id och starttid), så ett nytt
 * försök kan aldrig ge dubbletter.
 */
const KEY = 'milonpt.pendingSaves';

export interface PendingSave {
	/** Passets id, för att inte köa samma pass två gånger. */
	sessionId: string;
	workoutName: string;
	/** Det som skickas till POST /api/sessions. */
	body: unknown;
	/** Senaste felet från servern, om den svarat med fel. */
	error?: string;
}

export function pendingSaves(): PendingSave[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(parsed) ? (parsed as PendingSave[]) : [];
	} catch {
		return [];
	}
}

function write(list: PendingSave[]): boolean {
	try {
		if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
		else localStorage.removeItem(KEY);
		return true;
	} catch {
		return false;
	}
}

/** Lägger passet i kön. Ger false om localStorage inte går att skriva. */
export function queueSave(save: PendingSave): boolean {
	return write([...pendingSaves().filter((p) => p.sessionId !== save.sessionId), save]);
}

/** Ett fel som beror på nätet (inte på servern). */
export function isNetworkError(e: unknown): boolean {
	return e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

let flushing: Promise<PendingSave[]> | null = null;

/**
 * Försöker skicka alla köade pass. Returnerar det som ligger kvar. Ett
 * nätfel avbryter försöket; ett fel från servern sparas på posten så att
 * det kan visas.
 */
export function flushPendingSaves(fetcher: typeof fetch = fetch): Promise<PendingSave[]> {
	flushing ??= (async () => {
		try {
			for (const item of pendingSaves()) {
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
				const rest = pendingSaves().filter((p) => p.sessionId !== item.sessionId);
				if (res.ok) write(rest);
				else {
					const body = await res.json().catch(() => null);
					const error = res.status === 401 ? 'Logga in igen för att spara' : (body?.message ?? `Servern svarade ${res.status}`);
					write([...rest, { ...item, error }]);
				}
			}
			return pendingSaves();
		} finally {
			flushing = null;
		}
	})();
	return flushing;
}

export function discardPendingSave(sessionId: string): void {
	write(pendingSaves().filter((p) => p.sessionId !== sessionId));
}
