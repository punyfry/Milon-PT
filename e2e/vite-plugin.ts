import type { Connect, Plugin, ViteDevServer } from 'vite';

/**
 * Test-only endpoints on the dev server, for seeding and inspecting the UI
 * tests' in-memory storage. Registered only by `vite dev` with
 * `E2E_MEMORY_STORAGE=1` (set by `playwright.config.ts`); builds never contain it.
 *
 * - `POST /__e2e/files?user=<id>` with `{ "<path>": <json>, ... }` writes files.
 * - `GET /__e2e/files?user=<id>` returns all of the user's files as `{ "<path>": <json> }`.
 */
export function e2eStoragePlugin(): Plugin {
	return {
		name: 'milon-pt-e2e-storage',
		apply: 'serve',
		configureServer(server) {
			if (process.env.E2E_MEMORY_STORAGE !== '1') return;
			server.middlewares.use('/__e2e/files', (req, res) => {
				handle(server, req)
					.then((body) => {
						res.setHeader('content-type', 'application/json');
						res.end(JSON.stringify(body));
					})
					.catch((e: unknown) => {
						res.statusCode = 400;
						res.end(String(e));
					});
			});
		}
	};
}

async function handle(server: ViteDevServer, req: Connect.IncomingMessage): Promise<unknown> {
	const user = new URL(req.url ?? '', 'http://localhost').searchParams.get('user') ?? '';
	// Loaded through Vite rather than imported, so the config doesn't pull in app code.
	const { e2eStorage } = (await server.ssrLoadModule('/src/lib/server/storage/e2e.ts')) as typeof import('../src/lib/server/storage/e2e');
	const storage = e2eStorage(user);
	if (req.method === 'POST') {
		const files = JSON.parse(await readBody(req)) as Record<string, unknown>;
		for (const [path, data] of Object.entries(files)) await storage.writeJson(path, data);
		return { ok: true };
	}
	const out: Record<string, unknown> = {};
	for (const file of await storage.list()) out[file.path] = (await storage.readJson(file.path))?.data;
	return out;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = '';
		req.setEncoding('utf8');
		req.on('data', (chunk: string) => (body += chunk));
		req.on('end', () => resolve(body));
		req.on('error', reject);
	});
}
