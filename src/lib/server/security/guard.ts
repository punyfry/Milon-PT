import { error, redirect, type Handle } from '@sveltejs/kit';
import { isAllowedEmail } from '$lib/server/allowlist';

const PUBLIC_PATHS = ['/login', '/auth/'];

/** `/login` and everything under `/login/` and `/auth/`, but not e.g. `/login-x`. */
export function isPublic(pathname: string): boolean {
	return PUBLIC_PATHS.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * Every route except the login page and Auth.js' own endpoints requires a
 * session whose e-mail is still on the allowlist. The allowlist is checked
 * on every request, so removing an address locks it out without waiting for
 * the session cookie to expire.
 */
export const authorization: Handle = async ({ event, resolve }) => {
	const session = await event.locals.auth();
	const user = session?.user;

	if (user?.id && user.email && isAllowedEmail(user.email)) {
		event.locals.user = { id: user.id, email: user.email, name: user.name ?? null };
	} else {
		event.locals.user = null;
	}

	if (!event.locals.user && !isPublic(event.url.pathname)) {
		if (event.url.pathname.startsWith('/api/')) error(401, 'Inte inloggad');
		redirect(303, '/login');
	}

	return resolve(event);
};
