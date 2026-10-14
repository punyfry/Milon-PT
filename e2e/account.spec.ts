import type { Profile } from '../src/lib/model/types';
import { profile } from './data';
import { open, test, expect } from './fixtures';

test('the theme choice is applied and kept after a reload', async ({ page, user }) => {
	await user.seed(profile());
	await open(page, '/konto');
	await page.getByRole('button', { name: 'Mörkt' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the weekly goal is saved to the profile', async ({ page, user }) => {
	await user.seed(profile());
	await open(page, '/konto');
	// Each step is saved right away; wait for each save so the steps don't race.
	for (const goal of [1, 2, 3]) {
		await page.getByRole('button', { name: 'Öka veckomål' }).click();
		await expect.poll(async () => ((await user.files())['profile.json'] as Profile).weeklySessionGoal).toBe(goal);
	}
});

test('deleting the account deletes all files and signs out, after a confirmation', async ({ page, user }) => {
	await user.seed({ ...profile(), 'usage/2026-10-14.json': { count: 1 } });
	await open(page, '/konto');

	await page.getByRole('button', { name: 'Radera konto' }).click();
	const sheet = page.getByRole('dialog', { name: 'Radera konto' });
	await sheet.getByRole('button', { name: 'Avbryt' }).click();
	await expect(sheet).toBeHidden();
	expect(Object.keys(await user.files())).toHaveLength(2);

	await page.getByRole('button', { name: 'Radera konto' }).click();
	await sheet.getByRole('button', { name: 'Radera allt' }).click();
	await expect(page).toHaveURL(/\/login$/);
	// The AI counter is kept so the daily limit can't be reset by deleting the account.
	expect(Object.keys(await user.files())).toEqual(['usage/2026-10-14.json']);
});

test('deleting the account without a network says so in the sheet and deletes nothing', async ({ page, user }) => {
	await user.seed(profile());
	await open(page, '/konto');
	await page.getByRole('button', { name: 'Radera konto' }).click();
	await page.context().setOffline(true);
	const sheet = page.getByRole('dialog', { name: 'Radera konto' });
	await sheet.getByRole('button', { name: 'Radera allt' }).click();
	await expect(sheet.getByRole('alert')).toContainText('Kunde inte nå servern');
	await page.context().setOffline(false);
	expect(Object.keys(await user.files())).toEqual(['profile.json']);
});
