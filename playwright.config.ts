import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV, E2E_MILON_ENV, E2E_MILON_PORT, E2E_PORT } from './e2e/env';

// Lets a locally installed Chromium of another version be used (e.g. /opt/pw-browsers/chromium).
const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

/**
 * UI tests: Playwright against the dev server with in-memory storage and a fake
 * signed-in user. Most tests run with Milon unavailable (no API key); `*.milon.spec.ts`
 * run against a second server where Milon is answered by a fake Claude API.
 * See "UI tests" in README.md.
 */
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: `http://localhost:${E2E_PORT}`,
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		// The service worker caches pages, which would hide what a test just changed.
		serviceWorkers: 'block',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'mobile',
			testIgnore: '*.milon.spec.ts',
			use: { ...devices['Pixel 7'], launchOptions }
		},
		{
			name: 'milon',
			testMatch: '*.milon.spec.ts',
			use: { ...devices['Pixel 7'], launchOptions, baseURL: `http://localhost:${E2E_MILON_PORT}` }
		}
	],
	// Variables set here win over `.env`, so a local Blob token or API key is never used.
	webServer: [
		{
			command: `npx vite dev --port ${E2E_PORT} --strictPort`,
			url: `http://localhost:${E2E_PORT}/login`,
			env: E2E_ENV,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			command: `npx vite dev --port ${E2E_MILON_PORT} --strictPort`,
			url: `http://localhost:${E2E_MILON_PORT}/login`,
			env: E2E_MILON_ENV,
			// Never reused: a server already on this port (e.g. one started with the real `.env`)
			// could send the Milon tests to the real Claude API.
			reuseExistingServer: false,
			timeout: 120_000
		}
	]
});
