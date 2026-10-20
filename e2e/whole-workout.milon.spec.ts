import type { Locator, Page } from '@playwright/test';
import { exercise, profile, workout } from './data';
import { open, test, expect } from './fixtures';
import { FAKE_CLAUDE_REPLY, FAKE_CLAUDE_WHOLE_WORKOUT } from './vite-plugin';

// Milon proposes a whole workout at once, exercises can be swapped, and the list can be reordered. Runs against the Milon test server.

test.beforeEach(async ({ user }) => {
	await user.seed({
		...profile(),
		...exercise({ id: 'ex_knaboj', name: 'Knäböj' }),
		...exercise({ id: 'ex_marklyft', name: 'Marklyft' }),
		...exercise({ id: 'ex_utfall', name: 'Utfall' }),
		...workout({
			slug: 'ben',
			name: 'Ben',
			exercises: [
				{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8 } },
				{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 6 } }
			]
		})
	});
});

/** Drags a row by its handle (which is hidden from screen readers; the arrows are their way) onto another row. */
async function drag(page: Page, row: Locator, onto: Locator) {
	const from = (await row.locator('.handle').boundingBox())!;
	const to = (await onto.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 8 });
	await page.mouse.up();
}

async function conversation(files: Record<string, unknown>) {
	const [, c] = Object.entries(files).find(([path]) => path.startsWith('builder/'))!;
	return c as { draft: { exerciseId: string }[]; pendingNote?: string };
}

test('Milon proposes a whole workout as a card, and each exercise can be swapped', async ({ page }) => {
	await open(page, '/skapa');
	await page.getByLabel('Meddelande till Milon').fill(`Ben, 30 minuter ${FAKE_CLAUDE_WHOLE_WORKOUT}`);
	await page.getByRole('button', { name: 'Skicka' }).click();
	await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeVisible();

	const card = page.getByRole('group', { name: 'Passet' });
	await expect(card.getByRole('listitem')).toHaveCount(3);
	await expect(card.getByRole('listitem').nth(1)).toContainText('Marklyft');
	await expect(card.getByRole('listitem').nth(1)).toContainText('3 × 6 reps');
	// One card, not a line per exercise.
	await expect(page.getByText(/Lade till/)).toHaveCount(0);
	await expect(page.getByRole('button', { name: /3 övningar/ })).toBeVisible();

	await card.getByRole('button', { name: 'Byt Marklyft' }).click();
	await expect(page.getByText('Byt ut Marklyft.')).toBeVisible();
	await expect(page.getByText(FAKE_CLAUDE_REPLY)).toHaveCount(2);
});

test("the proposal can be reordered by dragging, and Milon hears about it with the next message", async ({ page, user }) => {
	await open(page, '/skapa');
	await page.getByLabel('Meddelande till Milon').fill(`Ben ${FAKE_CLAUDE_WHOLE_WORKOUT}`);
	await page.getByRole('button', { name: 'Skicka' }).click();
	await expect(page.getByText(FAKE_CLAUDE_REPLY)).toBeVisible();

	await page.getByRole('group', { name: 'Passet' }).getByRole('button', { name: 'Ändra ordning' }).click();
	const list = page.getByRole('list', { name: 'Ändra ordning' });
	await expect(list.getByRole('button', { name: 'Flytta upp Knäböj' })).toBeDisabled();
	await drag(page, list.getByRole('listitem').filter({ hasText: 'Utfall' }), list.getByRole('listitem').first());
	await expect(list.getByRole('listitem').first()).toContainText('Utfall');
	await page.getByRole('button', { name: 'Klar' }).click();

	await expect(page.getByText('Du ändrade ordningen')).toBeVisible();
	await expect(page.locator('#draftlist').getByRole('listitem').first()).toContainText('1. Utfall');
	const c = await conversation(await user.files());
	expect(c.draft.map((d) => d.exerciseId)).toEqual(['ex_utfall', 'ex_knaboj', 'ex_marklyft']);
	expect(c.pendingNote).toMatch(/1\. Utfall/);

	await page.getByLabel('Meddelande till Milon').fill('Ser bra ut');
	await page.getByRole('button', { name: 'Skicka' }).click();
	await expect(page.getByText(FAKE_CLAUDE_REPLY)).toHaveCount(2);
	expect((await conversation(await user.files())).pendingNote).toBeUndefined();
});

test('a workout being edited with Milon can be reordered with the arrows before the first message', async ({ page, user }) => {
	await open(page, '/skapa?pass=ben');
	await page.getByRole('button', { name: /2 övningar/ }).click();
	// Locked until unlocked.
	await expect(page.getByRole('button', { name: /Flytta/ })).toHaveCount(0);
	await page.getByRole('button', { name: 'Ändra ordning' }).click();
	// With the keyboard; the focus follows the moved exercise (on its other arrow, at the end of the list).
	await page.getByRole('button', { name: 'Flytta ner Knäböj' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Flytta upp Knäböj' })).toBeFocused();
	await page.getByRole('button', { name: 'Klar' }).click();

	await expect(page.getByText('Du ändrade ordningen')).toBeVisible();
	await expect(page).toHaveURL(/\/skapa\?c=b_/);
	expect((await conversation(await user.files())).draft.map((d) => d.exerciseId)).toEqual(['ex_marklyft', 'ex_knaboj']);
});

test('cancelling leaves the order as it was', async ({ page, user }) => {
	await open(page, '/skapa?pass=ben');
	await page.getByRole('button', { name: /2 övningar/ }).click();
	await page.getByRole('button', { name: 'Ändra ordning' }).click();
	await page.getByRole('button', { name: 'Flytta ner Knäböj' }).click();
	await page.getByRole('button', { name: 'Avbryt' }).click();
	await expect(page.locator('#draftlist').getByRole('listitem').first()).toContainText('1. Knäböj');
	expect(Object.keys(await user.files()).some((p) => p.startsWith('builder/'))).toBe(false);
});
