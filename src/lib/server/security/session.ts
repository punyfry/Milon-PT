const DAY = 24 * 60 * 60;

/**
 * Seconds a session lasts without use. Auth.js re-issues the session cookie
 * on every request that reads the session, so this is an idle timeout: using
 * the app keeps you signed in.
 */
export const SESSION_IDLE_SECONDS = 7 * DAY;

/** Seconds from signing in with Google until the session ends however much the app is used. */
export const SESSION_ABSOLUTE_SECONDS = 30 * DAY;

/**
 * Stamps the sign-in time on a new token and ends the session once it is
 * older than SESSION_ABSOLUTE_SECONDS (null tells Auth.js to clear it).
 * Tokens from before this stamp existed get it the first time they are seen.
 */
export function checkSessionAge<T extends Record<string, unknown>>(token: T, signingIn: boolean, now = Date.now()): T | null {
	const seconds = Math.floor(now / 1000);
	if (signingIn || typeof token.signedInAt !== 'number') return { ...token, signedInAt: seconds };
	return seconds - token.signedInAt > SESSION_ABSOLUTE_SECONDS ? null : token;
}
