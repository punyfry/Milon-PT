/**
 * One-off import from Craft into Vercel Blob.
 *
 *   npm run import -- <file.json> --user <userId>                   # shows the plan, writes nothing
 *   npm run import -- <file.json> --user <userId> --apply           # writes
 *   npm run import -- <file.json> --user <userId> --local --apply   # writes to .data/ (local dev)
 *
 * `userId` is your Google ID, shown on the start page when signed in.
 * `BLOB_READ_WRITE_TOKEN` is read from the environment or from .env / .env.local.
 */
import { existsSync, readFileSync } from 'node:fs';
import { BlobUserStorage } from '../src/lib/server/storage/blob';
import { LocalFileUserStorage } from '../src/lib/server/storage/local';
import { ValidationError } from '../src/lib/model';
import { todayInStockholm } from '../src/lib/time';
import { applyImport, countWrites, parseImportFile, planImportFor, summarizePlan } from '../src/lib/server/import/craft';

function usage(message?: string): never {
	if (message) console.error(message + '\n');
	console.error('Usage: npm run import -- <file.json> --user <userId> [--local] [--apply]');
	process.exit(1);
}

function parseArgs(argv: string[]) {
	let file: string | undefined;
	let user: string | undefined;
	let apply = false;
	let local = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--apply') apply = true;
		else if (a === '--local') local = true;
		else if (a === '--user') user = argv[++i];
		else if (a.startsWith('--user=')) user = a.slice('--user='.length);
		else if (a === '--help' || a === '-h') usage();
		else if (a.startsWith('-')) usage(`Unknown flag: ${a}`);
		else if (!file) file = a;
		else usage(`Unexpected argument: ${a}`);
	}
	if (!file) usage('Specify the import file.');
	if (!user) usage('Specify --user with your user ID (shown on the start page).');
	return { file, user, apply, local };
}

function loadEnv() {
	for (const f of ['.env.local', '.env']) {
		// Values already in the environment are not overwritten.
		if (existsSync(f)) process.loadEnvFile(f);
	}
}

async function main() {
	const { file, user, apply, local } = parseArgs(process.argv.slice(2));
	loadEnv();

	const input = parseImportFile(JSON.parse(readFileSync(file, 'utf8')));
	const storage = local ? new LocalFileUserStorage(user) : new BlobUserStorage(user, process.env.BLOB_READ_WRITE_TOKEN);
	const plan = await planImportFor(storage, input, todayInStockholm());

	console.log(summarizePlan(plan));
	const writes = countWrites(plan);

	if (!apply) {
		console.log(`\nDry run: ${writes} files would be written. Run again with --apply to import.`);
		return;
	}
	if (writes === 0) {
		console.log('\nNothing to import.');
		return;
	}
	await applyImport(storage, plan);
	console.log(`\nDone: ${writes} files written to ${local ? '.data/' : ''}users/${user}/.`);
}

main().catch((e) => {
	if (e instanceof ValidationError) console.error(e.message);
	else if (e instanceof SyntaxError) console.error(`The file is not valid JSON: ${e.message}`);
	else console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
