import type { Profile } from '../src/lib/model/types';
import { profile } from './data';
import { open, test, expect } from './fixtures';
import { FAKE_CLAUDE_ERROR, FAKE_NOTES_PROPOSAL } from './vite-plugin';

// What Milon knows about the user, on Konto (#110). Runs against the Milon test server.

test.beforeEach(async ({ user }) => {
	await user.seed(profile({ goals: 'Starkare', rules: ['Ont i knät', 'Inga hopp'], coachContext: 'Tränar: på gym\nErfarenhet: van vid styrketräning' }));
});

test('lists the rules and lines, and removes one', async ({ page, user }) => {
	await open(page, '/konto');
	const notes = page.getByRole('region', { name: 'Det här vet Milon om dig' });
	await expect(notes.getByRole('listitem')).toHaveText([/Ont i knät/, /Inga hopp/, /Tränar: på gym/, /Erfarenhet: van vid styrketräning/]);
	await notes.getByRole('button', { name: 'Ta bort: Ont i knät' }).click();
	await expect(notes.getByRole('button', { name: 'Ta bort: Ont i knät' })).toHaveCount(0);
	await expect.poll(async () => ((await user.files())['profile.json'] as Profile).rules).toEqual(['Inga hopp']);
	await notes.getByRole('button', { name: 'Ta bort: Erfarenhet: van vid styrketräning' }).click();
	await expect.poll(async () => ((await user.files())['profile.json'] as Profile).coachContext).toBe('Tränar: på gym');
	expect(((await user.files())['profile.json'] as Profile).goals).toBe('Starkare');
});

test("Milon's proposal is shown and saved only when approved", async ({ page, user }) => {
	await open(page, '/konto');
	const notes = page.getByRole('region', { name: 'Det här vet Milon om dig' });
	await notes.getByLabel('Har något ändrats? Berätta för Milon').fill('Knät är bra nu och jag tränar hemma med hantlar.');
	await notes.getByRole('button', { name: 'Fråga Milon' }).click();
	await expect(notes.getByText(FAKE_NOTES_PROPOSAL.summary)).toBeVisible();
	await expect(notes.getByRole('listitem').filter({ hasText: 'Tas bort: Ont i knät' })).toBeVisible();
	await expect(notes.getByRole('listitem').filter({ hasText: 'Läggs till: Tränar: hemma med hantlar' })).toBeVisible();
	// Nothing is saved yet.
	expect(((await user.files())['profile.json'] as Profile).rules).toEqual(['Ont i knät', 'Inga hopp']);

	await notes.getByRole('button', { name: 'Spara ändringarna' }).click();
	await expect.poll(async () => (await user.files())['profile.json']).toMatchObject({
		goals: 'Starkare',
		rules: ['Inga hopp'],
		coachContext: 'Tränar: hemma med hantlar'
	});
	await expect(notes.getByRole('button', { name: 'Ta bort: Tränar: hemma med hantlar' })).toBeVisible();
});

test('says so when Milon fails, and saves nothing', async ({ page, user }) => {
	await open(page, '/konto');
	const notes = page.getByRole('region', { name: 'Det här vet Milon om dig' });
	await notes.getByLabel('Har något ändrats? Berätta för Milon').fill(`Knät är bra ${FAKE_CLAUDE_ERROR}`);
	await notes.getByRole('button', { name: 'Fråga Milon' }).click();
	await expect(notes.getByRole('alert')).toContainText('Milon kunde inte svara just nu');
	expect(((await user.files())['profile.json'] as Profile).rules).toEqual(['Ont i knät', 'Inga hopp']);
});

test('cancelling a proposal saves nothing', async ({ page, user }) => {
	await open(page, '/konto');
	const notes = page.getByRole('region', { name: 'Det här vet Milon om dig' });
	await notes.getByLabel('Har något ändrats? Berätta för Milon').fill('Knät är bra nu.');
	await notes.getByRole('button', { name: 'Fråga Milon' }).click();
	await notes.getByRole('button', { name: 'Avbryt' }).click();
	await expect(notes.getByRole('button', { name: 'Spara ändringarna' })).toHaveCount(0);
	expect(((await user.files())['profile.json'] as Profile).rules).toEqual(['Ont i knät', 'Inga hopp']);
});

test('with Milon off the list can still be cleaned up, but not updated by Milon', async ({ page, user }) => {
	await user.seed(profile({ coach: false, rules: ['Ont i knät'] }));
	await open(page, '/konto');
	const notes = page.getByRole('region', { name: 'Det här vet Milon om dig' });
	await expect(notes.getByRole('button', { name: 'Ta bort: Ont i knät' })).toBeVisible();
	await expect(notes.getByRole('button', { name: 'Fråga Milon' })).toHaveCount(0);
});
