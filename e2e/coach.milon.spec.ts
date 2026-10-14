import type { Page } from '@playwright/test';
import { exercise, profile, workout } from './data';
import { open, test, expect } from './fixtures';
import { FAKE_CLAUDE_ERROR, FAKE_CLAUDE_REPLY } from './vite-plugin';

// Runs against the Milon test server: an API key is set and Claude is the fake in e2e/vite-plugin.ts.

/** Today's AI usage counter, as the server names it (the date in Stockholm). */
const usagePath = () => `usage/${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())}.json`;
const LIMIT = 50; // AI_DAILY_LIMIT is unset on the test server, so the default applies.

test.beforeEach(async ({ user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...workout({ slug: 'ben', name: 'Ben', exercises: [{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } }] })
	});
});

async function askAboutWorkout(page: Page, question: string) {
	await open(page, '/pass/ben');
	await page.getByRole('button', { name: 'Fråga Milon om passet' }).click();
	await page.getByLabel('Fråga till Milon').fill(question);
	await page.getByRole('button', { name: 'Skicka' }).click();
}

test.describe('the helper', () => {
	test('answers a question and counts the call', async ({ page, user }) => {
		await askAboutWorkout(page, 'Hur många set ska jag köra?');
		await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeVisible();
		expect((await user.files())[usagePath()]).toEqual({ count: 1 });
	});

	test('says so when Claude fails', async ({ page }) => {
		await askAboutWorkout(page, `Hjälp ${FAKE_CLAUDE_ERROR}`);
		await expect(page.getByRole('alert')).toContainText('Milon kunde inte svara just nu');
	});

	test('stops at the daily limit and counts nothing more', async ({ page, user }) => {
		await user.seed({ [usagePath()]: { count: LIMIT } });
		await askAboutWorkout(page, 'Hur många set ska jag köra?');
		await expect(page.getByRole('alert')).toContainText('Dagens gräns för Milon är nådd');
		await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeHidden();
		expect((await user.files())[usagePath()]).toEqual({ count: LIMIT });
	});
});

test.describe('the builder', () => {
	async function send(page: Page, message: string) {
		await open(page, '/skapa');
		await page.getByLabel('Meddelande till Milon').fill(message);
		await page.getByRole('button', { name: 'Skicka' }).click();
	}

	test('answers in a conversation that is saved', async ({ page, user }) => {
		await send(page, 'Bygg ett benpass');
		await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeVisible();
		await expect(page).toHaveURL(/\/skapa\?c=/);
		expect(Object.keys(await user.files()).some((p) => p.startsWith('builder/'))).toBe(true);
	});

	test('says so in the conversation when Claude fails, and keeps the message', async ({ page, user }) => {
		await send(page, `Bygg ett benpass ${FAKE_CLAUDE_ERROR}`);
		await expect(page.getByText('Milon kunde inte svara just nu')).toBeVisible();
		await expect(page.getByText(`Bygg ett benpass ${FAKE_CLAUDE_ERROR}`)).toBeVisible();
		await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeHidden();
		// The turn is saved, so the conversation can go on.
		expect(Object.keys(await user.files()).some((p) => p.startsWith('builder/'))).toBe(true);
	});

	test('stops at the daily limit and gives the message back to resend', async ({ page, user }) => {
		await user.seed({ [usagePath()]: { count: LIMIT } });
		await send(page, 'Bygg ett benpass');
		await expect(page.getByRole('alert')).toContainText('Dagens gräns för Milon är nådd');
		await expect(page.getByLabel('Meddelande till Milon')).toHaveValue('Bygg ett benpass');
		expect((await user.files())[usagePath()]).toEqual({ count: LIMIT });
	});
});

test('turning Milon off in Konto hides him and leads Skapa to building by hand', async ({ page, user }) => {
	await open(page, '/konto');
	await page.getByRole('group', { name: 'Milon' }).getByRole('button', { name: 'Av' }).click();
	await expect.poll(async () => (await user.files())['profile.json']).toMatchObject({ coach: false });

	await open(page, '/pass/ben');
	await expect(page.getByRole('button', { name: 'Starta passet' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Fråga Milon/ })).toHaveCount(0);
	await open(page, '/skapa');
	await expect(page).toHaveURL(/\/skapa\/manuell/);
});
