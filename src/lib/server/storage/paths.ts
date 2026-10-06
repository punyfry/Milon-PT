const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

export function userRoot(userId: string): string {
	if (!USER_ID.test(userId)) throw new Error('Ogiltigt userId');
	return `users/${userId}/`;
}

/**
 * Validates a user-relative path and returns the full pathname in the store.
 * Rejects traversal (`..`), absolute paths and unexpected characters so one
 * user can never address another user's files.
 */
export function resolvePath(userId: string, path: string, { file = true } = {}): string {
	const trimmed = file ? path : path.replace(/\/$/, '');
	if (trimmed === '') return userRoot(userId);
	const segments = trimmed.split('/');
	if (!segments.every((s) => SEGMENT.test(s) && s !== '..' && s !== '.')) {
		throw new Error(`Ogiltig sökväg: ${path}`);
	}
	if (file && !trimmed.endsWith('.json')) throw new Error(`Endast .json-filer: ${path}`);
	return userRoot(userId) + trimmed + (file ? '' : '/');
}
