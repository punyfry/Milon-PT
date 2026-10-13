/** Port of the UI tests' dev server; separate from `npm run dev` so they can run side by side. */
export const E2E_PORT = 5179;

export const E2E_EMAIL = 'e2e@example.com';
// Only signs session cookies for the local test server.
export const E2E_AUTH_SECRET = 'e2e-only-secret-not-used-anywhere-else';

/** Environment of the UI tests' dev server. */
export const E2E_ENV: Record<string, string> = {
	E2E_MEMORY_STORAGE: '1',
	AUTH_SECRET: E2E_AUTH_SECRET,
	ALLOWED_EMAILS: E2E_EMAIL,
	GOOGLE_OAUTH_CLIENT_ID: 'e2e',
	GOOGLE_OAUTH_CLIENT_SECRET: 'e2e',
	// Empty values override `.env`: no Blob, no Claude.
	BLOB_READ_WRITE_TOKEN: '',
	ANTHROPIC_API_KEY: '',
	AI_DAILY_LIMIT: ''
};
