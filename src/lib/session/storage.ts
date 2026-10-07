import { ACTIVE_SESSION_KEY, isObject, type ActiveSession } from '$lib/model';

/**
 * The active session lives in localStorage until it is saved. Reads and
 * writes tolerate localStorage being missing or throwing (private mode etc.).
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
		// Broken or unavailable: treat as no active session.
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
		// ignored
	}
}
