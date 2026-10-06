import { ACTIVE_SESSION_KEY, isObject, type ActiveSession } from '$lib/model';

/**
 * Det pågående passet lever i localStorage tills det sparats. Läsning och
 * skrivning tål att localStorage saknas eller kastar (privat läge m.m.).
 */
export function loadActiveSession(): ActiveSession | null {
	try {
		const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (
			isObject(parsed) &&
			typeof parsed.sessionId === 'string' &&
			typeof parsed.workoutSlug === 'string' &&
			typeof parsed.workoutVersion === 'number' &&
			typeof parsed.startedAt === 'string' &&
			typeof parsed.lastActivityAt === 'string' &&
			Array.isArray(parsed.exercises) &&
			Array.isArray(parsed.deviations)
		) {
			return parsed as unknown as ActiveSession;
		}
	} catch {
		// Trasigt eller otillgängligt: behandla som inget pågående pass.
	}
	return null;
}

export function saveActiveSession(session: ActiveSession): boolean {
	try {
		localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
		return true;
	} catch {
		return false;
	}
}

export function clearActiveSession(): void {
	try {
		localStorage.removeItem(ACTIVE_SESSION_KEY);
	} catch {
		// ignoreras
	}
}
