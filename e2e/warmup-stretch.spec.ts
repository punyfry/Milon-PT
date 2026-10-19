import type { Exercise, SessionRecord, WorkoutTemplate } from '../src/lib/model/types';
import { exercise, profile, session, workout } from './data';
import { open, test, expect } from './fixtures';

// Warm-up and stretch as optional parts of a workout (#100).

test('the manual builder adds a warm-up and a stretch around the main part', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...exercise({ id: 'ex_jumping_jacks', name: 'Jumping jacks', type: 'bodyweight' })
	});
	await open(page, '/skapa/manuell');
	await page.getByPlaceholder('T.ex. Pass A').fill('Ben');

	// The stretch first, written in: it defaults to a timed exercise.
	await page.getByRole('button', { name: 'Lägg till stretch' }).click();
	await page.getByRole('button', { name: 'Skriv in en ny övning' }).click();
	await page.getByRole('textbox', { name: 'Namn', exact: true }).fill('Höftböjarstretch');
	await page.getByRole('button', { name: 'Lägg till Höftböjarstretch' }).click();

	await page.getByRole('button', { name: 'Lägg till övning' }).click();
	await page.getByRole('button', { name: /Knäböj/ }).click();

	// A warm-up has no weights, so weight exercises aren't offered.
	await page.getByRole('button', { name: 'Lägg till uppvärmning' }).click();
	await expect(page.getByRole('dialog').getByRole('button', { name: /Knäböj/ })).toHaveCount(0);
	await page.getByRole('button', { name: /Jumping jacks/ }).click();

	await expect(page.getByRole('region', { name: 'Uppvärmning' })).toContainText('Jumping jacks');
	await expect(page.getByRole('region', { name: 'Stretch' })).toContainText('Höftböjarstretch');
	await page.getByRole('button', { name: 'Spara pass' }).click();
	await expect(page.getByRole('status')).toContainText('Sparat som version 1.');

	const files = await user.files();
	const saved = files['workouts/ben.v1.json'] as WorkoutTemplate;
	const stretchId = Object.values(files).find((f) => (f as Exercise).name === 'Höftböjarstretch') as Exercise;
	expect(stretchId.type).toBe('time');
	expect(saved.exercises).toEqual([
		{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 10 }, phase: 'warmup' },
		{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 10 } },
		{ exerciseId: stretchId.id, sets: 1, target: { seconds: 30 }, phase: 'cooldown' }
	]);
});

test('runs a workout: skips the warm-up, ticks off the stretches, and the totals and records only count the main part', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_jumping_jacks', name: 'Jumping jacks', type: 'bodyweight' }),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj', log: [{ sessionId: 's_20260101', date: '2026-01-01', sets: [{ weight: 40, reps: 8 }] }] }),
		// 20 s before: 30 s in the stretch would be a record if it counted.
		...exercise({ id: 'ex_hoftbojare', name: 'Höftböjarstretch', type: 'time', log: [{ sessionId: 's_20260101', date: '2026-01-01', sets: [{ seconds: 20 }] }] }),
		...exercise({ id: 'ex_baksida', name: 'Baksida lår', type: 'time' }),
		...workout({
			slug: 'ben',
			name: 'Ben',
			exercises: [
				{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 20 }, phase: 'warmup' },
				{ exerciseId: 'ex_knaboj', sets: 2, target: { reps: 8 } },
				{ exerciseId: 'ex_hoftbojare', sets: 1, target: { seconds: 30 }, phase: 'cooldown' },
				{ exerciseId: 'ex_baksida', sets: 2, target: { seconds: 30 }, phase: 'cooldown' }
			]
		})
	});
	await open(page, '/pass/ben');
	// The overview is split into the three parts and counts the main part.
	for (const part of ['Uppvärmning', 'Pass', 'Stretch']) await expect(page.getByRole('heading', { name: part, exact: true })).toBeVisible();
	await expect(page.getByText('1 övning · 2 set')).toBeVisible();
	await page.getByRole('button', { name: 'Starta passet' }).click();

	await expect(page.getByText('Uppvärmning 1 av 1')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Jumping jacks' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Minska reps' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Hoppa över uppvärmningen' }).click();

	await expect(page.getByRole('heading', { name: 'Knäböj' })).toBeVisible();
	await page.getByRole('button', { name: 'Klarmarkera set 1' }).click();
	await page.getByRole('button', { name: 'Klarmarkera set 2' }).click();
	await page.getByRole('button', { name: /Nästa: Höftböjarstretch/ }).click();

	await expect(page.getByText('Stretch 1 av 2')).toBeVisible();
	await page.getByRole('button', { name: 'Klar: Höftböjarstretch' }).click();
	await expect(page.getByRole('button', { name: 'Klar: Höftböjarstretch' })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: /Nästa: Baksida lår/ }).click();
	await page.getByRole('button', { name: 'Klar: Baksida lår, set 1' }).click();
	await page.getByRole('button', { name: 'Klar: Baksida lår, set 2' }).click();
	await page.getByRole('button', { name: /Sammanfattning/ }).click();

	// Totals and records are for the main part only.
	await expect(page.getByText('2/2', { exact: true })).toBeVisible();
	await expect(page.getByText('PR', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Jumping jacks: ändra' })).toContainText('Inte gjord');
	await expect(page.getByRole('button', { name: 'Höftböjarstretch: ändra' })).not.toContainText('PR');
	await page.getByRole('button', { name: 'Avsluta pass' }).click();
	await expect(page).toHaveURL(/\/($|\?)/);

	const files = await user.files();
	const record = Object.entries(files).find(([p]) => p.startsWith('sessions/'))![1] as SessionRecord;
	expect(record.exerciseIds).toEqual(['ex_knaboj', 'ex_hoftbojare', 'ex_baksida']);
	expect((files['exercises/ex_jumping_jacks.json'] as Exercise).log).toEqual([]);
	expect((files['exercises/ex_knaboj.json'] as Exercise).log[0]).not.toHaveProperty('phase');
	expect((files['exercises/ex_hoftbojare.json'] as Exercise).log[0]).toMatchObject({ sessionId: record.id, sets: [{ seconds: 30 }], phase: 'cooldown' });

	// The history shows the stretch as done, without a record.
	await open(page, '/historik/ovning/ex_hoftbojare');
	const latest = page.getByRole('listitem').filter({ hasText: 'Stretch' });
	await expect(latest).toHaveCount(1);
	await expect(latest).not.toContainText('PR');
});

test('editing a saved session keeps a stretch a stretch', async ({ page, user }) => {
	const id = 's_20261006';
	const startedAt = '2026-10-06T17:00:00+02:00';
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj', log: [{ sessionId: id, startedAt, date: '2026-10-06', sets: [{ weight: 60, reps: 5 }] }] }),
		...exercise({
			id: 'ex_hoftbojare',
			name: 'Höftböjarstretch',
			type: 'time',
			log: [{ sessionId: id, startedAt, date: '2026-10-06', sets: [{ seconds: 30 }], phase: 'cooldown' }]
		}),
		...workout({
			slug: 'ben',
			name: 'Ben',
			exercises: [
				{ exerciseId: 'ex_knaboj', sets: 1, target: { reps: 5 } },
				{ exerciseId: 'ex_hoftbojare', sets: 1, target: { seconds: 30 }, phase: 'cooldown' }
			]
		}),
		...session({ id, workoutSlug: 'ben', startedAt, endedAt: '2026-10-06T17:45:00+02:00', exerciseIds: ['ex_knaboj', 'ex_hoftbojare'] })
	});
	await open(page, `/historik/pass/${id}`);
	await expect(page.getByRole('listitem').filter({ hasText: 'Höftböjarstretch' })).toContainText('Stretch');
	await page.getByRole('button', { name: 'Redigera' }).click();
	await page.getByRole('region', { name: 'Höftböjarstretch' }).getByLabel('Sekunder, set 1').fill('45');
	await page.getByRole('button', { name: 'Spara ändringar' }).click();
	await expect(page.getByRole('button', { name: 'Redigera' })).toBeVisible();

	const entry = ((await user.files())['exercises/ex_hoftbojare.json'] as Exercise).log[0];
	expect(entry).toMatchObject({ sessionId: id, sets: [{ seconds: 45 }], phase: 'cooldown' });
});

test('"Byt" on a warm-up exercise offers no weight exercises and keeps the warm-up', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_jumping_jacks', name: 'Jumping jacks', type: 'bodyweight' }),
		...exercise({ id: 'ex_hoga_knan', name: 'Höga knän', type: 'bodyweight' }),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...exercise({ id: 'ex_marklyft', name: 'Marklyft' }),
		...workout({
			slug: 'ben',
			name: 'Ben',
			exercises: [
				{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 20 }, phase: 'warmup' },
				{ exerciseId: 'ex_knaboj', sets: 1, target: { reps: 8 } }
			]
		})
	});
	await open(page, '/pass/ben');
	await page.getByRole('button', { name: 'Byt Jumping jacks' }).click();
	const picker = page.getByRole('dialog');
	await expect(picker.getByRole('button', { name: /Höga knän/ })).toBeVisible();
	await expect(picker.getByRole('button', { name: /Marklyft/ })).toHaveCount(0);
	await picker.getByRole('button', { name: /Höga knän/ }).click();

	// Still the warm-up: first under its heading, ticked off without −/+.
	await expect(page.getByRole('listitem').filter({ hasText: 'Höga knän' })).toContainText('Inbytt');
	await page.getByRole('button', { name: 'Starta passet' }).click();
	await expect(page.getByText('Uppvärmning 1 av 1')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Höga knän' })).toBeVisible();
	await page.getByRole('button', { name: 'Klar: Höga knän' }).click();
	await page.getByRole('button', { name: /Nästa: Knäböj/ }).click();
	await page.getByRole('button', { name: 'Klarmarkera set 1' }).click();
	await page.getByRole('button', { name: /Sammanfattning/ }).click();
	await page.getByRole('button', { name: 'Avsluta pass' }).click();
	await expect(page).toHaveURL(/\/($|\?)/);

	const files = await user.files();
	expect((files['exercises/ex_hoga_knan.json'] as Exercise).log[0]).toMatchObject({ sets: [{ reps: 20 }], phase: 'warmup' });
});

test('a workout with only the warm-up done counts as abandoned and cannot be saved', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_jumping_jacks', name: 'Jumping jacks', type: 'bodyweight' }),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...workout({
			slug: 'ben',
			name: 'Ben',
			exercises: [
				{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 20 }, phase: 'warmup' },
				{ exerciseId: 'ex_knaboj', sets: 2, target: { reps: 8 } }
			]
		})
	});
	await open(page, '/pass/ben');
	await page.getByRole('button', { name: 'Starta passet' }).click();
	await page.getByRole('button', { name: 'Klar: Jumping jacks' }).click();
	await page.getByRole('button', { name: /Nästa: Knäböj/ }).click();
	await page.getByRole('button', { name: /Sammanfattning/ }).click();

	await expect(page.getByRole('heading', { name: 'Passet är inte gjort' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Avsluta pass' })).toBeDisabled();
	await expect(page.getByText('Bara uppvärmning eller stretch är avbockat.', { exact: false })).toBeVisible();

	// Discarding it leaves nothing behind.
	await page.getByRole('button', { name: 'Släng passet' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Släng passet' }).click();
	await expect(page).toHaveURL(/\/($|\?)/);
	const files = await user.files();
	expect(Object.keys(files).some((p) => p.startsWith('sessions/'))).toBe(false);
	expect((files['exercises/ex_jumping_jacks.json'] as Exercise).log).toEqual([]);
});
