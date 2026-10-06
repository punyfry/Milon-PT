/**
 * Engångsimport från Craft till Vercel Blob.
 *
 *   npm run import -- <fil.json> --user <userId>            # visar planen, skriver inget
 *   npm run import -- <fil.json> --user <userId> --apply    # skriver
 *
 * `userId` är ditt Google-ID, som visas på startsidan när du är inloggad.
 * `BLOB_READ_WRITE_TOKEN` läses från miljön eller från .env / .env.local.
 */
import { existsSync, readFileSync } from 'node:fs';
import { BlobUserStorage } from '../src/lib/server/storage/blob';
import { ValidationError } from '../src/lib/model';
import { applyImport, parseImportFile, planImportFor, summarizePlan } from '../src/lib/server/import/craft';

function usage(message?: string): never {
	if (message) console.error(message + '\n');
	console.error('Användning: npm run import -- <fil.json> --user <userId> [--apply]');
	process.exit(1);
}

function parseArgs(argv: string[]) {
	let file: string | undefined;
	let user: string | undefined;
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--apply') apply = true;
		else if (a === '--user') user = argv[++i];
		else if (a.startsWith('--user=')) user = a.slice('--user='.length);
		else if (a === '--help' || a === '-h') usage();
		else if (a.startsWith('-')) usage(`Okänd flagga: ${a}`);
		else if (!file) file = a;
		else usage(`Oväntat argument: ${a}`);
	}
	if (!file) usage('Ange importfilen.');
	if (!user) usage('Ange --user med ditt användar-ID (visas på startsidan).');
	return { file, user, apply };
}

function loadEnv() {
	for (const f of ['.env.local', '.env']) {
		// Värden som redan finns i miljön skrivs inte över.
		if (existsSync(f)) process.loadEnvFile(f);
	}
}

function todayInStockholm(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
}

async function main() {
	const { file, user, apply } = parseArgs(process.argv.slice(2));
	loadEnv();

	const input = parseImportFile(JSON.parse(readFileSync(file, 'utf8')));
	const storage = new BlobUserStorage(user, process.env.BLOB_READ_WRITE_TOKEN);
	const plan = await planImportFor(storage, input, todayInStockholm());

	console.log(summarizePlan(plan));
	const writes =
		plan.exercises.filter((p) => p.action !== 'unchanged').length +
		plan.workouts.filter((p) => p.action !== 'unchanged').length;

	if (!apply) {
		console.log(`\nTorrkörning: ${writes} filer skulle skrivas. Kör igen med --apply för att importera.`);
		return;
	}
	if (writes === 0) {
		console.log('\nInget att importera.');
		return;
	}
	await applyImport(storage, plan);
	console.log(`\nKlart: ${writes} filer skrevs till users/${user}/.`);
}

main().catch((e) => {
	if (e instanceof ValidationError) console.error(e.message);
	else if (e instanceof SyntaxError) console.error(`Filen är inte giltig JSON: ${e.message}`);
	else console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
