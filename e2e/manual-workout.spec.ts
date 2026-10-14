import type { WorkoutTemplate } from '../src/lib/model/types';
import { exercise, profile } from './data';
import { open, test, expect } from './fixtures';

test('builds a workout by hand and it appears on the start page', async ({ page, user }) => {
	// Without an API key, /skapa leads to building by hand.
	await user.seed({ ...profile(), ...exercise({ id: 'ex_rodd', name: 'Hantelrodd' }) });
	await open(page, '/skapa');
	await expect(page).toHaveURL(/\/skapa\/manuell/);

	await page.getByPlaceholder('T.ex. Pass A').fill('Rygg');
	await page.getByRole('button', { name: 'Lägg till övning' }).click();
	await page.getByRole('button', { name: /Hantelrodd/ }).click();
	await page.getByRole('button', { name: 'Fler set' }).click();
	await page.getByRole('button', { name: 'Spara pass' }).click();
	await expect(page.getByRole('status')).toContainText('Sparat som version 1.');

	await open(page, '/');
	await expect(page.getByRole('link', { name: /Rygg/ })).toContainText('Hantelrodd');
	const saved = Object.values(await user.files()).find((f) => (f as WorkoutTemplate).slug !== undefined) as WorkoutTemplate;
	expect(saved).toMatchObject({ name: 'Rygg', version: 1 });
	expect(saved.exercises).toHaveLength(1);
	expect(saved.exercises[0].exerciseId).toBe('ex_rodd');
});
