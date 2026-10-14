import type { Page } from '@playwright/test';
import type { Exercise, SessionRecord } from '../src/lib/model/types';
import { exercise, profile, workout } from './data';
import { open, test, expect } from './fixtures';

test.beforeEach(async ({ user }) => {
	await user.seed({
		...profile(),
		...exercise({
			id: 'ex_knaboj',
			name: 'Knäböj',
			log: [{ sessionId: 's_20260101', date: '2026-01-01', sets: [{ weight: 40, reps: 8 }], note: 'Prova 45 kg' }]
		}),
		...workout({ slug: 'ben', name: 'Ben', exercises: [{ exerciseId: 'ex_knaboj', sets: 2, target: { reps: 8 } }] })
	});
});

test('logs a workout from the start page to a saved session', async ({ page, user }) => {
	await open(page, '/');
	await page.getByRole('link', { name: /Ben/ }).click();

	// The overview shows last time's note before the workout starts.
	await expect(page.getByText('Prova 45 kg')).toBeVisible();
	await page.getByRole('button', { name: 'Starta passet' }).click();

	await expect(page.getByRole('heading', { name: 'Knäböj' })).toBeVisible();
	await page.getByRole('button', { name: 'Klarmarkera set 1' }).click();
	await page.getByRole('button', { name: 'Klarmarkera set 2' }).click();

	await page.getByRole('button', { name: /Sammanfattning/ }).click();
	await expect(page.getByRole('button', { name: 'Knäböj: ändra' })).toContainText('40×8 · 40×8');
	await page.getByRole('button', { name: 'Avsluta pass' }).click();
	await expect(page).toHaveURL(/\/($|\?)/);

	const files = await user.files();
	const sessions = Object.entries(files).filter(([path]) => path.startsWith('sessions/'));
	expect(sessions).toHaveLength(1);
	const record = sessions[0][1] as SessionRecord;
	expect(record).toMatchObject({ workoutSlug: 'ben', workoutVersion: 1, exerciseIds: ['ex_knaboj'], deviations: [] });
	const knaboj = files['exercises/ex_knaboj.json'] as Exercise;
	expect(knaboj.log[0]).toMatchObject({ sessionId: record.id, sets: [{ weight: 40, reps: 8 }, { weight: 40, reps: 8 }] });
});

/** Starts the seeded workout "Ben" and checks off the first set. */
async function startAndCheckFirstSet(page: Page) {
	await open(page, '/pass/ben');
	await page.getByRole('button', { name: 'Starta passet' }).click();
	await page.getByRole('button', { name: 'Klarmarkera set 1' }).click();
	await expect(page.getByRole('button', { name: /^Set 1, klart/ })).toBeVisible();
}

test('a workout in progress survives a reload and shows on the start page', async ({ page }) => {
	await startAndCheckFirstSet(page);
	await page.reload({ waitUntil: 'networkidle' });
	await expect(page.getByRole('button', { name: /^Set 1, klart/ })).toBeVisible();

	await page.getByRole('button', { name: 'Stäng passet' }).click();
	await page.getByRole('button', { name: 'Pausa och gå till start' }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.getByRole('link', { name: /Ben/ }).first().click();
	await expect(page.getByRole('button', { name: /^Set 1, klart/ })).toBeVisible();
});

test('a failed save keeps the workout so it can be saved again, once', async ({ page, user }) => {
	await startAndCheckFirstSet(page);
	await page.getByRole('button', { name: /Sammanfattning/ }).click();

	let fail = true;
	await page.route('/api/sessions', (route) =>
		fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Serverfel' }) }) : route.continue()
	);
	await page.getByRole('button', { name: 'Avsluta pass' }).click();
	await expect(page.getByRole('alert')).toContainText('Passet ligger kvar i telefonen');

	fail = false;
	await page.getByRole('button', { name: 'Avsluta pass' }).click();
	await expect(page).toHaveURL(/\/$/);
	const files = await user.files();
	expect(Object.keys(files).filter((p) => p.startsWith('sessions/'))).toHaveLength(1);
	expect((files['exercises/ex_knaboj.json'] as Exercise).log).toHaveLength(2);
});

test('a workout finished offline is queued and saved when the network is back', async ({ page, user }) => {
	await startAndCheckFirstSet(page);
	await page.getByRole('button', { name: /Sammanfattning/ }).click();

	await page.route('/api/sessions', (route) => route.abort('internetdisconnected'));
	await page.getByRole('button', { name: 'Avsluta pass' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('status').filter({ hasText: 'Ben' })).toContainText('väntar på att sparas');
	expect(Object.keys(await user.files()).filter((p) => p.startsWith('sessions/'))).toHaveLength(0);

	await page.unroute('/api/sessions');
	await page.getByRole('button', { name: 'Försök nu' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'väntar på att sparas' })).toBeHidden();
	expect(Object.keys(await user.files()).filter((p) => p.startsWith('sessions/'))).toHaveLength(1);
});
