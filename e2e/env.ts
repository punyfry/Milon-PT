/** Port of the UI tests' dev server; separate from `npm run dev` so they can run side by side. */
export const E2E_PORT = 5179;
/** Port of a second dev server with Milon available, answered by the fake Claude API. */
export const E2E_MILON_PORT = 5180;

export const E2E_EMAIL = 'e2e@example.com';
// Only signs session cookies for the local test server.
export const E2E_AUTH_SECRET = 'e2e-only-secret-not-used-anywhere-else';

/** Environment of the UI tests' dev server. */
export const E2E_ENV: Record<string, string> = {
	E2E_MEMORY_STORAGE: '1',
	AUTH_SECRET: E2E_AUTH_SECRET,
	ALLOWED_EMAILS: E2E_EMAIL,
	// The test user may use the Craft import (e2e/import.spec.ts).
	IMPORT_EMAILS: E2E_EMAIL,
	GOOGLE_OAUTH_CLIENT_ID: 'e2e',
	GOOGLE_OAUTH_CLIENT_SECRET: 'e2e',
	// Empty values override `.env`: no Blob, no Claude.
	BLOB_READ_WRITE_TOKEN: '',
	ANTHROPIC_API_KEY: '',
	AI_DAILY_LIMIT: ''
};

/**
 * Environment of the Milon test server: an API key so Milon is available, and the
 * SDK pointed at the fake Claude API on the same server (`e2e/vite-plugin.ts`).
 */
export const E2E_MILON_ENV: Record<string, string> = {
	...E2E_ENV,
	ANTHROPIC_API_KEY: 'e2e-not-a-real-key',
	ANTHROPIC_BASE_URL: `http://localhost:${E2E_MILON_PORT}/__e2e/claude`
};
