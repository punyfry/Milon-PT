import { exercise, profile, workout } from './data';
import { open, test, expect } from './fixtures';

// The default test server has no API key, so Milon is unavailable whatever the profile says.

test('without an API key Milon is hidden everywhere', async ({ page, user }) => {
	await user.seed({
		...profile({ coach: true }),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...workout({ slug: 'ben', name: 'Ben', exercises: [{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } }] })
	});
	await open(page, '/pass/ben');
	await expect(page.getByRole('button', { name: 'Starta passet' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Fråga Milon/ })).toHaveCount(0);

	await open(page, '/konto');
	await expect(page.getByRole('group', { name: 'Tema' })).toBeVisible();
	await expect(page.getByRole('group', { name: 'Milon' })).toHaveCount(0);

	// The endpoints refuse before anything is counted or saved.
	expect((await page.request.post('/api/helper', { data: { question: 'Hej' } })).status()).toBe(503);
	expect((await page.request.post('/api/builder', { data: { message: 'Hej' } })).status()).toBe(503);
	expect(Object.keys(await user.files()).some((p) => p.startsWith('usage/') || p.startsWith('builder/'))).toBe(false);
});
