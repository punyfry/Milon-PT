import type { Handle } from '@sveltejs/kit';

/**
 * Säkerhetsheaders på alla svar från servern. Content-Security-Policy sätts
 * av SvelteKit (`kit.csp` i svelte.config.js), eftersom den behöver hashar
 * för SvelteKits egna inline-skript.
 */
export const SECURITY_HEADERS: Record<string, string> = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Strict-Transport-Security': 'max-age=63072000; includeSubDomains'
};

export const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		// Svar med låsta headers (t.ex. omdirigeringar från fetch) lämnas som de är.
		try {
			if (!response.headers.has(name)) response.headers.set(name, value);
		} catch {
			break;
		}
	}
	return response;
};
