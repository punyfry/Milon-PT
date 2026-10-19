import type { Exercise } from '../src/lib/model/types';
import { exercise, profile, workout } from './data';
import { open, test, expect } from './fixtures';

test.beforeEach(async ({ user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj', log: [{ sessionId: 's_20260101', date: '2026-01-01', sets: [{ weight: 40, reps: 8 }] }] }),
		...workout({ slug: 'ben', name: 'Ben', exercises: [{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } }] })
	});
});

test('a change to a set carries over to the following open sets with the same value (#103)', async ({ page, user }) => {
	await open(page, '/pass/ben');
	await page.getByRole('button', { name: 'Starta passet' }).click();
	const row = (n: number) => page.getByRole('button', { name: new RegExp(`^Set ${n}, (kommande|klart):`) });
	const weight = page.getByRole('textbox', { name: 'Vikt i kg, set 1' });

	// −/+ on set 1 carries over to sets 2 and 3.
	await page.getByRole('button', { name: 'Öka reps' }).click();
	await expect(row(2)).toHaveAccessibleName(/40 kg × 9\./);
	await expect(row(3)).toHaveAccessibleName(/40 kg × 9\./);

	// So does a typed weight.
	await weight.fill('42,5');
	await weight.press('Enter');
	await expect(row(2)).toHaveAccessibleName(/kommande: 42,5 kg × 9\./);
	await expect(row(3)).toHaveAccessibleName(/kommande: 42,5 kg × 9\./);

	// A done set keeps its value; the open set after it still follows.
	await row(2).click();
	await page.getByRole('button', { name: 'Klarmarkera set 2' }).click();
	// Checking a set moves on to the first open one: set 1.
	await weight.fill('45');
	await weight.press('Enter');
	await expect(row(2)).toHaveAccessibleName(/klart: 42,5 kg × 9\./);
	await expect(row(3)).toHaveAccessibleName(/kommande: 45 kg × 9\./);

	await page.getByRole('button', { name: 'Klarmarkera set 1' }).click();
	await page.getByRole('button', { name: 'Klarmarkera set 3' }).click();
	await page.getByRole('button', { name: /Sammanfattning/ }).click();
	await page.getByRole('button', { name: 'Avsluta pass' }).click();
	await expect(page).toHaveURL(/\/($|\?)/);

	const knaboj = (await user.files())['exercises/ex_knaboj.json'] as Exercise;
	expect(knaboj.log.find((e) => e.date !== '2026-01-01')?.sets).toEqual([
		{ weight: 45, reps: 9 },
		{ weight: 42.5, reps: 9 },
		{ weight: 45, reps: 9 }
	]);
});
