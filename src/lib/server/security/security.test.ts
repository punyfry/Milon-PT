import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../../test/env-private';
import { allowedEmails, isAllowedEmail } from '../allowlist';
import { authorization, isPublic } from './guard';
import { SECURITY_HEADERS, securityHeaders } from './headers';

type Session = { user?: { id?: string; email?: string | null; name?: string | null } } | null;

/** Runs the guard for a path and a session. Returns the response or whatever was thrown. */
async function guard(pathname: string, session: Session) {
	const locals = { auth: async () => session, user: undefined } as unknown as App.Locals;
	const event = { url: new URL(`https://milon.test${pathname}`), locals };
	try {
		const response = await authorization({
			event: event as never,
			resolve: async () => new Response('ok')
		});
		return { response, locals };
	} catch (thrown) {
		return { thrown, locals };
	}
}

afterEach(() => {
	delete env.ALLOWED_EMAILS;
});

describe('allowlist', () => {
	it('lets nobody in when the list is missing or empty', () => {
		expect(allowedEmails().size).toBe(0);
		expect(isAllowedEmail('sofie@example.com')).toBe(false);
		env.ALLOWED_EMAILS = ' , ';
		expect(isAllowedEmail('sofie@example.com')).toBe(false);
	});

	it('compares ignoring case and whitespace', () => {
		env.ALLOWED_EMAILS = ' Sofie@Example.com ,annan@example.com';
		expect(isAllowedEmail('sofie@example.com')).toBe(true);
		expect(isAllowedEmail(' SOFIE@example.COM ')).toBe(true);
		expect(isAllowedEmail('sofie@example.co')).toBe(false);
		expect(isAllowedEmail(null)).toBe(false);
	});
});

describe('login guard', () => {
	const user = { id: '116464423308083623377', email: 'sofie@example.com', name: 'Sofie' };

	it('answers 401 on the API and redirects pages without a session', async () => {
		const api = await guard('/api/sessions', null);
		expect(isHttpError(api.thrown) && api.thrown.status).toBe(401);
		const page = await guard('/historik', null);
		expect(isRedirect(page.thrown) && [page.thrown.status, page.thrown.location]).toEqual([303, '/login']);
	});

	it('locks out an address not on the list, even with a valid session', async () => {
		env.ALLOWED_EMAILS = 'annan@example.com';
		const result = await guard('/api/import', { user });
		expect(isHttpError(result.thrown) && result.thrown.status).toBe(401);
		expect(result.locals.user).toBeNull();
	});

	it('requires both id and e-mail', async () => {
		env.ALLOWED_EMAILS = user.email;
		expect(isHttpError((await guard('/api/x', { user: { email: user.email } })).thrown)).toBe(true);
		expect(isHttpError((await guard('/api/x', { user: { id: user.id } })).thrown)).toBe(true);
	});

	it('lets an allowed user in and sets locals.user', async () => {
		env.ALLOWED_EMAILS = user.email;
		const result = await guard('/', { user });
		expect(await result.response?.text()).toBe('ok');
		expect(result.locals.user).toEqual(user);
	});

	it('keeps the login page and Auth.js open, but nothing that merely resembles them', async () => {
		for (const path of ['/login', '/auth/signin/google', '/auth/callback/google']) {
			expect(isPublic(path), path).toBe(true);
			expect((await guard(path, null)).response?.status, path).toBe(200);
		}
		for (const path of ['/login-x', '/loginapi', '/authx', '/auth', '/api/auth/x', '/']) {
			expect(isPublic(path), path).toBe(false);
		}
	});
});

describe('security headers', () => {
	it('are set on responses', async () => {
		const response = await securityHeaders({
			event: {} as never,
			resolve: async () => new Response('ok')
		});
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name), name).toBe(value);
	});

	it('handles responses with immutable headers', async () => {
		const locked = Response.redirect('https://milon.test/login', 303);
		await expect(securityHeaders({ event: {} as never, resolve: async () => locked })).resolves.toBe(locked);
	});
});
