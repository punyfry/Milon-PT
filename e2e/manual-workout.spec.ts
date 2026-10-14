import type { WorkoutTemplate } from '../src/lib/model/types';
import { exercise, profile, workout } from './data';
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

test('editing a workout saves a new version, and an older one can be restored', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_rodd', name: 'Hantelrodd' }),
		...exercise({ id: 'ex_press', name: 'Bänkpress' }),
		...workout({ slug: 'rygg', name: 'Rygg', exercises: [{ exerciseId: 'ex_rodd', sets: 3, target: { reps: 10 } }] })
	});
	await open(page, '/skapa/manuell?pass=rygg');
	await page.getByRole('button', { name: 'Lägg till övning' }).click();
	await page.getByRole('button', { name: /Bänkpress/ }).click();
	await page.getByRole('button', { name: 'Spara pass' }).click();
	await expect(page.getByRole('status')).toContainText('Sparat som version 2.');
	expect(((await user.files())['workouts/rygg.v2.json'] as WorkoutTemplate).exercises).toHaveLength(2);

	page.on('dialog', (d) => void d.accept());
	await page.getByRole('button', { name: 'Versioner' }).click();
	await page.getByRole('listitem').filter({ hasText: 'v1' }).getByRole('button', { name: 'Återställ' }).click();
	await expect.poll(async () => (await user.files())['workouts/rygg.v3.json']).toMatchObject({ exercises: [{ exerciseId: 'ex_rodd' }] });
	// Versions are never overwritten.
	expect(((await user.files())['workouts/rygg.v2.json'] as WorkoutTemplate).exercises).toHaveLength(2);
});
