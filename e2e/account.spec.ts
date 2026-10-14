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
