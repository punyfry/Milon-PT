import type { WorkoutTemplate } from '../src/lib/model/types';
import { profile } from './data';
import { open, test, expect } from './fixtures';

const EXAMPLE = 'scripts/import-example.json';

test('a Craft import is shown first, saved on Importera and not repeated', async ({ page, user }) => {
	await user.seed(profile());
	await open(page, '/konto');
	const file = page.getByLabel('Välj fil');

	await file.setInputFiles(EXAMPLE);
	await expect(page.getByText(/filer skulle sparas från import-example\.json/)).toBeVisible();
	expect(Object.keys(await user.files())).toEqual(['profile.json']);

	await page.getByRole('button', { name: 'Importera' }).click();
	await expect(page.getByRole('status')).toContainText('Klart:');
	const files = await user.files();
	expect(files['exercises/ex_marklyft.json']).toBeDefined();
	expect((files['workouts/pass-a.v1.json'] as WorkoutTemplate).exercises).toHaveLength(3);

	// Choosing the same file again finds nothing new.
	await file.setInputFiles([]);
	await file.setInputFiles(EXAMPLE);
	await expect(page.getByRole('status')).toContainText('Inget att importera');
});

test('a file that is not JSON is refused with a message', async ({ page, user }) => {
	await user.seed(profile());
	await open(page, '/konto');
	await page.getByLabel('Välj fil').setInputFiles({ name: 'fel.json', mimeType: 'application/json', buffer: Buffer.from('inte json') });
	await expect(page.getByRole('alert')).toContainText('Filen är inte giltig JSON.');
	expect(Object.keys(await user.files())).toEqual(['profile.json']);
});
