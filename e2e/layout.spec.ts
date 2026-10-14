import { exercise, profile, session, workout } from './data';
import { open, test, expect } from './fixtures';

const PAGES = ['/', '/historik', '/historik/ovning/ex_knaboj', '/historik/pass/s_20261006', '/skapa/manuell', '/konto', '/pass/ben'];

for (const theme of ['light', 'dark'] as const) {
	test(`no page scrolls sideways on a phone (${theme})`, async ({ page, user }) => {
		await user.seed({
			...profile(),
			...exercise({
				id: 'ex_knaboj',
				name: 'Knäböj med ett ganska långt namn för att testa radbrytning',
				log: [{ sessionId: 's_20261006', date: '2026-10-06', sets: [{ weight: 100, reps: 5 }], note: 'En anteckning som är lång nog att behöva brytas över flera rader på en telefon.' }]
			}),
			...workout({ slug: 'ben', name: 'Ben', exercises: [{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 5 } }] }),
			...session({ id: 's_20261006', workoutSlug: 'ben', startedAt: '2026-10-06T17:00:00+02:00', endedAt: '2026-10-06T18:00:00+02:00', exerciseIds: ['ex_knaboj'] })
		});
		await page.addInitScript((t) => localStorage.setItem('milonpt.theme', t), theme);
		for (const path of PAGES) {
			await open(page, path);
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			expect(overflow, path).toBeLessThanOrEqual(0);
			await expect(page.locator('html'), path).toHaveAttribute('data-theme', theme);
		}
	});
}
