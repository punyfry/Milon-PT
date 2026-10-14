import { env } from '$env/dynamic/private';

/** Parses a comma-separated list of e-mail addresses (trimmed, lower case). */
function emailList(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? '')
			.split(',')
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean)
	);
}

/**
 * Parses ALLOWED_EMAILS (comma separated). An empty or missing value lets
 * nobody in — the allowlist fails closed.
 */
export function allowedEmails(): Set<string> {
	return emailList(env.ALLOWED_EMAILS);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
	if (!email) return false;
	return allowedEmails().has(email.trim().toLowerCase());
}

/**
 * The Craft import is made for the owner's own export, so it is only offered to the
 * addresses in IMPORT_EMAILS (comma separated). Empty or missing hides it for everyone.
 */
export function canImport(email: string | null | undefined): boolean {
	if (!email) return false;
	return emailList(env.IMPORT_EMAILS).has(email.trim().toLowerCase());
}
