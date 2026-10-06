import { env } from '$env/dynamic/private';

/**
 * Parses ALLOWED_EMAILS (comma separated). An empty or missing value lets
 * nobody in — the allowlist fails closed.
 */
export function allowedEmails(): Set<string> {
	return new Set(
		(env.ALLOWED_EMAILS ?? '')
			.split(',')
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean)
	);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
	if (!email) return false;
	return allowedEmails().has(email.trim().toLowerCase());
}
