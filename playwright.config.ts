import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV, E2E_PORT } from './e2e/env';

/**
 * UI tests: Playwright against the dev server with in-memory storage, a fake
 * signed-in user and Milon unavailable (no API key). See "UI tests" in README.md.
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
			use: {
				...devices['Pixel 7'],
				// Lets a locally installed Chromium of another version be used (e.g. /opt/pw-browsers/chromium).
				launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
			}
		}
	],
	webServer: {
		command: `npx vite dev --port ${E2E_PORT} --strictPort`,
		url: `http://localhost:${E2E_PORT}/login`,
		// Variables set here win over `.env`, so a local Blob token or API key is never used.
		env: E2E_ENV,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
