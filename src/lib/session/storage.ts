import { ACTIVE_SESSION_KEY, isObject, type ActiveSession } from '$lib/model';
import { clearPendingSaves } from './outbox';

/** The account the active session belongs to, kept next to it so the session itself is unchanged. */
const OWNER_KEY = 'milonpt.activeSessionOwner';

/**
 * The active session lives in localStorage until it is saved. Reads and
 * writes tolerate localStorage being missing or throwing (private mode etc.).
 *
 * A session belongs to the account that started it: another account on the
 * same device never sees it. A session from before the owner was stored is
 * taken over by the first account that opens it.
 */
export function loadActiveSession(userId: string | null): ActiveSession | null {
	if (!userId) return null;
	try {
		const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
		if (!raw) return null;
		const owner = localStorage.getItem(OWNER_KEY);
		if (owner && owner !== userId) return null;
		if (!owner) localStorage.setItem(OWNER_KEY, userId);
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

export function saveActiveSession(session: ActiveSession, userId: string | null): boolean {
	try {
		if (userId) localStorage.setItem(OWNER_KEY, userId);
		localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
		return true;
	} catch {
		return false;
	}
}

export function clearActiveSession(): void {
	try {
		localStorage.removeItem(ACTIVE_SESSION_KEY);
		localStorage.removeItem(OWNER_KEY);
	} catch {
		// ignored
	}
}

/**
 * Everything the app keeps in the browser for the signed-in user: the
 * active session and the workouts waiting to be sent. Run on sign-out.
 * The theme stays, since it belongs to the device rather than the account.
 */
export function clearUserData(): void {
	clearActiveSession();
	clearPendingSaves();
}
