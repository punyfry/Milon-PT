import type { WorkoutTemplate } from '../src/lib/model/types';
import { exercise, profile } from './data';
import { open, test, expect } from './fixtures';
import { FAKE_CLAUDE_REPLY, FAKE_CLAUDE_SAVE_WITH_PARTS } from './vite-plugin';

// Runs against the Milon test server; the fake Claude saves a workout with a warm-up and a stretch (#100).

test('Milon saves a workout with a warm-up and a stretch, in that order', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...exercise({ id: 'ex_jumping_jacks', name: 'Jumping jacks', type: 'bodyweight' }),
		...exercise({ id: 'ex_hoftbojare', name: 'Höftböjarstretch', type: 'time' })
	});
	await open(page, '/skapa');
	await page.getByLabel('Meddelande till Milon').fill(`Bygg ett benpass med uppvärmning och stretch ${FAKE_CLAUDE_SAVE_WITH_PARTS}`);
	await page.getByRole('button', { name: 'Skicka' }).click();
	await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeVisible();
	await expect(page.getByText('Sparat som version 1.')).toBeVisible();

	// The live list shows which part each exercise belongs to.
	await page.getByRole('button', { name: /3 övningar/ }).click();
	const list = page.locator('#draftlist');
	await expect(list.getByRole('listitem').nth(0)).toContainText('Jumping jacks');
	await expect(list.getByRole('listitem').nth(0)).toContainText('Uppvärmning');
	await expect(list.getByRole('listitem').nth(2)).toContainText('Höftböjarstretch');
	await expect(list.getByRole('listitem').nth(2)).toContainText('Stretch');

	const saved = (await user.files())['workouts/ben-med-stretch.v1.json'] as WorkoutTemplate;
	expect(saved.exercises).toEqual([
		{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 20 }, phase: 'warmup' },
		{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } },
		{ exerciseId: 'ex_hoftbojare', sets: 1, target: { seconds: 30 }, phase: 'cooldown' }
	]);
});
