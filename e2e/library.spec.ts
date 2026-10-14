import type { Exercise } from '../src/lib/model/types';
import { exercise, profile } from './data';
import { open, test, expect } from './fixtures';

test('creates an exercise in the library and finds it by search', async ({ page, user }) => {
	await user.seed({ ...profile(), ...exercise({ id: 'ex_marklyft', name: 'Marklyft' }) });
	await open(page, '/historik');
	await expect(page.getByRole('link', { name: /Marklyft/ })).toBeVisible();

	await page.getByRole('button', { name: 'Ny övning' }).click();
	await page.getByLabel('Namn').fill('Plankan');
	await page.getByRole('button', { name: 'Tid' }).click();
	await page.getByRole('button', { name: 'Spara', exact: true }).click();

	// Saving opens the new exercise's page.
	await expect(page.getByRole('heading', { name: 'Plankan' })).toBeVisible();
	await page.getByRole('link', { name: 'Tillbaka till biblioteket' }).click();
	await expect(page.getByRole('link', { name: /Plankan/ })).toContainText('inte tränad än');
	await page.getByPlaceholder('Sök övning').fill('plank');
	await expect(page.getByRole('link', { name: /Plankan/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /Marklyft/ })).toBeHidden();

	const created = Object.values(await user.files()).find((f) => (f as Exercise).name === 'Plankan') as Exercise;
	expect(created).toMatchObject({ type: 'time', log: [] });
});
