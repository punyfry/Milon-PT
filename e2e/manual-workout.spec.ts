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

test('the order is locked until unlocked, and can then be changed by dragging or with the arrows', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_rodd', name: 'Hantelrodd' }),
		...exercise({ id: 'ex_press', name: 'Bänkpress' }),
		...exercise({ id: 'ex_pull', name: 'Chins' }),
		...workout({
			slug: 'rygg',
			name: 'Rygg',
			exercises: [
				{ exerciseId: 'ex_rodd', sets: 3, target: { reps: 10 } },
				{ exerciseId: 'ex_press', sets: 3, target: { reps: 8 } },
				{ exerciseId: 'ex_pull', sets: 3, target: { reps: 6 } }
			]
		})
	});
	await open(page, '/skapa/manuell?pass=rygg');
	await expect(page.getByRole('button', { name: /Flytta/ })).toHaveCount(0);
	await page.getByRole('button', { name: 'Ändra ordning' }).click();

	const list = page.getByRole('region', { name: 'Övningar' }).getByRole('list');
	const row = (name: string) => list.getByRole('listitem').filter({ hasText: name });
	// Chins is dragged to the top by its handle (hidden from screen readers; the arrows are their way).
	const from = (await row('Chins').locator('.handle').boundingBox())!;
	const to = (await row('Hantelrodd').boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 8 });
	await page.mouse.up();
	await expect(list.getByRole('listitem').first()).toContainText('Chins');

	await page.getByRole('button', { name: 'Flytta ner Hantelrodd' }).click();
	await page.getByRole('button', { name: 'Klar' }).click();
	await expect(page.getByRole('button', { name: /Flytta/ })).toHaveCount(0);
	await page.getByRole('button', { name: 'Spara pass' }).click();
	await expect(page.getByRole('status')).toContainText('Sparat som version 2.');
	const saved = (await user.files())['workouts/rygg.v2.json'] as WorkoutTemplate;
	expect(saved.exercises.map((e) => e.exerciseId)).toEqual(['ex_pull', 'ex_press', 'ex_rodd']);
});
