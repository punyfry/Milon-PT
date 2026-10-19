import type { Exercise } from '../src/lib/model/types';
import { exercise, profile, session, workout } from './data';
import { open, test, expect } from './fixtures';

const ID = 's_20261006';
const STARTED = '2026-10-06T17:00:00+02:00';

test.beforeEach(async ({ user }) => {
	await user.seed({
		...profile(),
		...exercise({
			id: 'ex_marklyft',
			name: 'Marklyft',
			log: [{ sessionId: ID, startedAt: STARTED, date: '2026-10-06', sets: [{ weight: 60, reps: 5 }, { weight: 60, reps: 5 }] }]
		}),
		...workout({ slug: 'rygg', name: 'Rygg', exercises: [{ exerciseId: 'ex_marklyft', sets: 2, target: { reps: 5 } }] }),
		...session({ id: ID, workoutSlug: 'rygg', startedAt: STARTED, endedAt: '2026-10-06T17:45:00+02:00', exerciseIds: ['ex_marklyft'], kcalEstimate: 300 })
	});
});

test('the session view shows times, kcal and sets', async ({ page }) => {
	await open(page, `/historik/pass/${ID}`);
	await expect(page.getByRole('heading', { name: 'Rygg' })).toBeVisible();
	// The value (dd) next to a label (dt) in the stats list.
	const stat = (term: string) => page.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
	await expect(stat('Start')).toHaveText('17:00');
	await expect(stat('Kcal')).toHaveText('300');
	await expect(page.getByRole('listitem').filter({ hasText: 'Marklyft' })).toContainText('60');
});

test('editing a set is saved to the exercise log', async ({ page, user }) => {
	await open(page, `/historik/pass/${ID}`);
	await page.getByRole('button', { name: 'Redigera' }).click();
	await expect(page.getByLabel('Kcal')).toHaveCount(0);
	await page.getByLabel('Vikt i kg, set 2').fill('62.5');
	await page.getByRole('button', { name: 'Spara ändringar' }).click();
	await expect(page.getByRole('button', { name: 'Redigera' })).toBeVisible();

	const log = ((await user.files())['exercises/ex_marklyft.json'] as Exercise).log;
	expect(log[0].sets).toEqual([{ weight: 60, reps: 5 }, { weight: 62.5, reps: 5 }]);
	// The editor has no kcal field any more, and an older value survives the edit.
	expect(((await user.files())[`sessions/${ID}.json`] as { kcalEstimate?: number }).kcalEstimate).toBe(300);
});

test('a set above the upper bounds is not saved (#89)', async ({ page, user }) => {
	await open(page, `/historik/pass/${ID}`);
	await page.getByRole('button', { name: 'Redigera' }).click();
	await page.getByLabel('Vikt i kg, set 2').fill('1000');
	await page.getByRole('button', { name: 'Spara ändringar' }).click();
	await expect(page.getByText(/Kontrollera värdena för Marklyft \(högst 500 kg/)).toBeVisible();
	expect(((await user.files())['exercises/ex_marklyft.json'] as Exercise).log[0].sets[1]).toEqual({ weight: 60, reps: 5 });
});

test('an edit made in another tab since the page was loaded is not overwritten', async ({ page, context, user }) => {
	const other = await context.newPage();
	await open(page, `/historik/pass/${ID}`);
	await open(other, `/historik/pass/${ID}`);

	await other.getByRole('button', { name: 'Redigera' }).click();
	await other.getByLabel('Reps, set 1').fill('6');
	await other.getByRole('button', { name: 'Spara ändringar' }).click();
	await expect(other.getByRole('button', { name: 'Redigera' })).toBeVisible();

	await page.getByRole('button', { name: 'Redigera' }).click();
	await page.getByLabel('Reps, set 1').fill('4');
	await page.getByRole('button', { name: 'Spara ändringar' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	// The view reloads what is stored: the other tab's change.
	await page.getByRole('button', { name: 'Avbryt' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'Marklyft' })).toContainText('60 kg × 6 · 60 kg × 5');
	expect(((await user.files())['exercises/ex_marklyft.json'] as Exercise).log[0].sets[0]).toEqual({ weight: 60, reps: 6 });
});

test('deleting a session removes it and its sets', async ({ page, user }) => {
	await open(page, `/historik/pass/${ID}`);
	await page.getByRole('button', { name: 'Ta bort pass' }).click();
	await page.getByRole('button', { name: 'Ta bort passet' }).click();
	await expect(page).toHaveURL(/\/historik\?vecka=2026-10-06/);

	const files = await user.files();
	expect(files[`sessions/${ID}.json`]).toBeUndefined();
	expect((files['exercises/ex_marklyft.json'] as Exercise).log).toEqual([]);
});
