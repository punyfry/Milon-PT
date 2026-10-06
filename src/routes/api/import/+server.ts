import { error, json } from '@sveltejs/kit';
import { isObject, ValidationError } from '$lib/model';
import { applyImport, countWrites, parseImportFile, planImportFor, summarizePlan } from '$lib/server/import/craft';
import { storageFor, StorageConflictError } from '$lib/server/storage';
import { todayInStockholm } from '$lib/time';
import type { RequestHandler } from './$types';

const MAX_BYTES = 1_000_000;

/**
 * Import från Craft för den inloggade användaren: { data, apply }.
 * Utan `apply` görs en torrkörning som bara visar planen.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const storage = storageFor(locals);
	const text = await request.text();
	if (text.length > MAX_BYTES) error(413, 'Filen är för stor (max 1 MB)');
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		error(400, 'Ogiltig JSON');
	}
	if (!isObject(body)) error(400, 'Ogiltig förfrågan');

	try {
		const input = parseImportFile(body.data);
		const plan = await planImportFor(storage, input, todayInStockholm());
		const writes = countWrites(plan);
		const apply = body.apply === true && writes > 0;
		if (apply) await applyImport(storage, plan);
		return json({ applied: apply, writes, summary: summarizePlan(plan).split('\n'), warnings: plan.warnings });
	} catch (e) {
		if (e instanceof ValidationError) return json({ issues: e.issues }, { status: 400 });
		if (e instanceof StorageConflictError) error(409, 'Något ändrades under importen. Kör torrkörningen igen.');
		throw e;
	}
};
