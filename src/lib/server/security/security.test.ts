import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../../test/env-private';
import { allowedEmails, isAllowedEmail } from '../allowlist';
import { authorization, isPublic } from './guard';
import { SECURITY_HEADERS, securityHeaders } from './headers';

type Session = { user?: { id?: string; email?: string | null; name?: string | null } } | null;

/** Kör vakten för en sökväg och en session. Returnerar svaret eller det som kastades. */
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
	it('släpper inte in någon när listan saknas eller är tom', () => {
		expect(allowedEmails().size).toBe(0);
		expect(isAllowedEmail('sofie@example.com')).toBe(false);
		env.ALLOWED_EMAILS = ' , ';
		expect(isAllowedEmail('sofie@example.com')).toBe(false);
	});

	it('jämför utan hänsyn till skiftläge och blanksteg', () => {
		env.ALLOWED_EMAILS = ' Sofie@Example.com ,annan@example.com';
		expect(isAllowedEmail('sofie@example.com')).toBe(true);
		expect(isAllowedEmail(' SOFIE@example.COM ')).toBe(true);
		expect(isAllowedEmail('sofie@example.co')).toBe(false);
		expect(isAllowedEmail(null)).toBe(false);
	});
});

describe('inloggningsvakten', () => {
	const user = { id: '116464423308083623377', email: 'sofie@example.com', name: 'Sofie' };

	it('svarar 401 på API och omdirigerar sidor utan session', async () => {
		const api = await guard('/api/sessions', null);
		expect(isHttpError(api.thrown) && api.thrown.status).toBe(401);
		const page = await guard('/historik', null);
		expect(isRedirect(page.thrown) && [page.thrown.status, page.thrown.location]).toEqual([303, '/login']);
	});

	it('stänger ute en adress som inte står på listan, även med giltig session', async () => {
		env.ALLOWED_EMAILS = 'annan@example.com';
		const result = await guard('/api/import', { user });
		expect(isHttpError(result.thrown) && result.thrown.status).toBe(401);
		expect(result.locals.user).toBeNull();
	});

	it('kräver både id och e-post', async () => {
		env.ALLOWED_EMAILS = user.email;
		expect(isHttpError((await guard('/api/x', { user: { email: user.email } })).thrown)).toBe(true);
		expect(isHttpError((await guard('/api/x', { user: { id: user.id } })).thrown)).toBe(true);
	});

	it('släpper in en tillåten användare och sätter locals.user', async () => {
		env.ALLOWED_EMAILS = user.email;
		const result = await guard('/', { user });
		expect(await result.response?.text()).toBe('ok');
		expect(result.locals.user).toEqual(user);
	});

	it('låter inloggningssidan och Auth.js vara öppna, men inget som bara liknar dem', async () => {
		for (const path of ['/login', '/auth/signin/google', '/auth/callback/google']) {
			expect(isPublic(path), path).toBe(true);
			expect((await guard(path, null)).response?.status, path).toBe(200);
		}
		for (const path of ['/login-x', '/loginapi', '/authx', '/auth', '/api/auth/x', '/']) {
			expect(isPublic(path), path).toBe(false);
		}
	});
});

describe('säkerhetsheaders', () => {
	it('sätts på svaren', async () => {
		const response = await securityHeaders({
			event: {} as never,
			resolve: async () => new Response('ok')
		});
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name), name).toBe(value);
	});

	it('klarar svar med låsta headers', async () => {
		const locked = Response.redirect('https://milon.test/login', 303);
		await expect(securityHeaders({ event: {} as never, resolve: async () => locked })).resolves.toBe(locked);
	});
});
