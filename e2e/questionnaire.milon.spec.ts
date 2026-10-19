import type { Profile } from '../src/lib/model/types';
import { exercise, profile, workout } from './data';
import { open, test, expect } from './fixtures';
import { FAKE_CLAUDE_REPLY } from './vite-plugin';

// The questionnaire for describing a new workout (#102). Runs against the Milon test server.

test.beforeEach(async ({ user }) => {
	await user.seed({
		...profile({ rules: ['Inga hopp'] }),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...workout({ slug: 'ben', name: 'Ben', exercises: [{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } }] })
	});
});

test('the answers become an editable first message, and chosen answers are saved to the profile', async ({ page, user }) => {
	await open(page, '/skapa');
	await page.getByRole('button', { name: 'Hjälp mig beskriva passet' }).click();
	await expect(page).toHaveURL(/\/skapa\?steg=1$/);
	const next = page.getByRole('button', { name: 'Nästa' });

	await expect(page.getByRole('group', { name: 'Vad ska passet fokusera på?' })).toBeVisible();
	await page.getByRole('checkbox', { name: 'Ben' }).check();
	await page.getByRole('checkbox', { name: 'Core' }).check();
	await next.click();
	await expect(page.getByText('Fråga 2 av 8')).toBeVisible();
	await page.getByRole('button', { name: 'Hoppa över' }).click();
	await page.getByRole('radio', { name: 'Annat…' }).check();
	await page.getByRole('textbox', { name: 'Annat: Hur tufft ska det vara?' }).fill('lagom');
	await next.click();
	await page.getByRole('radio', { name: 'Bara uppvärmning' }).check();
	await next.click();
	await page.getByRole('radio', { name: 'På gym' }).check();
	await page.getByRole('checkbox', { name: /Spara i profilen/ }).check();
	await next.click();
	await page.getByRole('button', { name: 'Hoppa över' }).click();
	// The rules Milon already has are shown.
	await expect(page.getByRole('listitem').filter({ hasText: 'Inga hopp' })).toBeVisible();
	await page.getByRole('textbox').fill('Ont i knät');
	await page.getByRole('checkbox', { name: /Spara i profilen/ }).check();
	await next.click();
	await page.getByRole('button', { name: 'Klart' }).click();

	const message = page.getByLabel('Meddelande till Milon');
	await expect(message).toHaveValue(
		[
			'Hej! Hjälp mig bygga ett nytt pass.',
			'Fokus: ben och core.',
			'Intensitet: lagom.',
			'Ta med uppvärmning men ingen stretch.',
			'Jag tränar på gym.',
			'Undvik: Ont i knät.'
		].join('\n')
	);
	expect((await user.files())['profile.json']).toMatchObject({ coachContext: 'Tränar: på gym', rules: ['Inga hopp', 'Ont i knät'] });

	await message.fill(`${await message.inputValue()}\nMax 40 minuter.`);
	await page.getByRole('button', { name: 'Skicka' }).click();
	await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeVisible();
	await expect(page.getByText('Max 40 minuter.')).toBeVisible();
});

test('nothing is saved to the profile without the choice, and a known answer is preselected', async ({ page, user }) => {
	await user.seed(profile({ coachContext: 'Tränar: hemma med hantlar' }));
	await open(page, '/skapa?steg=5');
	await expect(page.getByRole('radio', { name: 'Hemma med hantlar' })).toBeChecked();
	await expect(page.getByText('Milon vet redan det här från din profil.')).toBeVisible();
	await page.getByRole('button', { name: 'Nästa' }).click();
	await page.getByRole('radio', { name: 'Van', exact: true }).check();
	await page.getByRole('button', { name: 'Nästa' }).click();
	await expect(page.getByText('Fråga 7 av 8')).toBeVisible();
	await page.getByRole('button', { name: 'Nästa' }).click();
	await page.getByRole('button', { name: 'Klart' }).click();
	// Place is already known, so only the new answer is in the message.
	await expect(page.getByLabel('Meddelande till Milon')).toHaveValue('Hej! Hjälp mig bygga ett nytt pass.\nErfarenhet: van vid styrketräning.');
	expect(((await user.files())['profile.json'] as Profile).coachContext).toBe('Tränar: hemma med hantlar');
});

test('the step and the answers survive back and a reload, and the first step leads back to free text', async ({ page }) => {
	await open(page, '/skapa');
	await page.getByRole('button', { name: 'Hjälp mig beskriva passet' }).click();
	await page.getByRole('checkbox', { name: 'Rygg' }).check();
	await page.getByRole('button', { name: 'Nästa' }).click();
	await page.getByRole('radio', { name: '30 min' }).check();
	await page.reload();
	await expect(page.getByText('Fråga 2 av 8')).toBeVisible();
	await expect(page.getByRole('radio', { name: '30 min' })).toBeChecked();
	await page.getByRole('button', { name: 'Tillbaka' }).click();
	await expect(page.getByRole('checkbox', { name: 'Rygg' })).toBeChecked();
	await page.getByRole('button', { name: 'Skriv själv i stället' }).click();
	await expect(page.getByText('Hej! Vad ska passet fokusera på, och hur lång tid har du?')).toBeVisible();
	await expect(page.getByLabel('Meddelande till Milon')).toHaveValue('');
});

test('is not offered when a workout is edited', async ({ page }) => {
	await open(page, '/skapa?pass=ben&steg=1');
	await expect(page.getByText('Vad vill du ändra i Ben?')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Hjälp mig beskriva passet' })).toHaveCount(0);
	await expect(page.getByText(/Fråga 1 av/)).toHaveCount(0);
});

test("the intro's first workout with Milon starts with the questionnaire", async ({ page, user }) => {
	await user.seed({ 'profile.json': {} });
	await open(page, '/valkommen?steg=10&val=on');
	await page.getByRole('button', { name: 'Bygg mitt första pass med Milon' }).click();
	await expect(page).toHaveURL(/\/skapa\?steg=1$/);
	await expect(page.getByText('Fråga 1 av 8')).toBeVisible();
});
