import type { Handle } from '@sveltejs/kit';

/**
 * Security headers on every server response. Content-Security-Policy is set
 * by SvelteKit (`kit.csp` in svelte.config.js), since it needs hashes for
 * SvelteKit's own inline scripts.
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
		// Responses with immutable headers (e.g. redirects from fetch) are left as is.
		try {
			if (!response.headers.has(name)) response.headers.set(name, value);
		} catch {
			break;
		}
	}
	return response;
};
