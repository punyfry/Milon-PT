import { open, test, expect } from './fixtures';
import { exercise, profile, workout } from './data';

test('without a session every page leads to the login', async ({ page }) => {
	await open(page, '/historik');
	await expect(page).toHaveURL(/\/login$/);
});

test('a new user starts with the intro', async ({ page, user }) => {
	void user; // Requested only for its sign-in cookie.
	await open(page, '/');
	await expect(page).toHaveURL(/\/valkommen/);
});

test('the start page shows the seeded workouts', async ({ page, user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...workout({ slug: 'ben', name: 'Ben', exercises: [{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } }] })
	});
	await open(page, '/');
	await expect(page.getByText('Ben', { exact: true })).toBeVisible();
	await expect(page.getByText('Knäböj')).toBeVisible();
});
