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
