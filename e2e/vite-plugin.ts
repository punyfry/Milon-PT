import type { Connect, Plugin, ViteDevServer } from 'vite';

/**
 * Test-only endpoints on the dev server, for seeding and inspecting the UI
 * tests' in-memory storage. Registered only by `vite dev` with
 * `E2E_MEMORY_STORAGE=1` (set by `playwright.config.ts`); builds never contain it.
 *
 * - `POST /__e2e/files?user=<id>` with `{ "<path>": <json>, ... }` writes files.
 * - `GET /__e2e/files?user=<id>` returns all of the user's files as `{ "<path>": <json> }`.
 * - `/__e2e/claude/v1/messages` is a fake Claude API. The Milon test server points the SDK at it
 *   with `ANTHROPIC_BASE_URL`, so no test ever reaches the real API (see `fakeClaude`).
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
						// No keep-alive: the test runner would otherwise reuse a socket the server is
						// just closing after its idle timeout, which fails with ECONNRESET.
						res.setHeader('connection', 'close');
						res.setHeader('content-type', 'application/json');
						res.end(JSON.stringify(body));
					})
					.catch((e: unknown) => {
						res.statusCode = 400;
						res.setHeader('connection', 'close');
						res.end(String(e));
					});
			});
			server.middlewares.use('/__e2e/claude', (req, res) => {
				readBody(req)
					.then((body) => {
						const reply = fakeClaude(body);
						res.statusCode = reply.status;
						res.setHeader('connection', 'close');
						res.setHeader('content-type', 'application/json');
						res.end(JSON.stringify(reply.body));
					})
					.catch(() => {
						res.statusCode = 500;
						res.end();
					});
			});
		}
	};
}

/** Put in a question to Milon to make the fake Claude API answer with an error. */
export const FAKE_CLAUDE_ERROR = '#fel';
export const FAKE_CLAUDE_REPLY = 'Hej! Det här är ett testsvar från Milon.';

/**
 * Put in a builder message to make the fake Claude save FAKE_WORKOUT_WITH_PARTS with
 * `set_workout` (a warm-up, the main part and a stretch, #100) before it replies.
 */
export const FAKE_CLAUDE_SAVE_WITH_PARTS = '#uppvarmning-och-stretch';
/** What the fake saves; the test seeds these exercises. Given out of order: the app puts the warm-up first. */
export const FAKE_WORKOUT_WITH_PARTS = {
	name: 'Ben med stretch',
	changeNote: 'Nytt pass',
	exercises: [
		{ exerciseId: 'ex_hoftbojare', sets: 1, target: { reps: null, seconds: 30 }, phase: 'cooldown' },
		{ exerciseId: 'ex_knaboj', sets: 3, target: { reps: 8, seconds: null }, phase: 'main' },
		{ exerciseId: 'ex_jumping_jacks', sets: 1, target: { reps: 20, seconds: null }, phase: 'warmup' }
	]
};

/**
 * Answers a Messages API request with a short text reply, or with a 400 error
 * (which the SDK doesn't retry) when the request contains FAKE_CLAUDE_ERROR.
 * With FAKE_CLAUDE_SAVE_WITH_PARTS it first calls `set_workout`, and replies once the tool result is back.
 */
function fakeClaude(body: string): { status: number; body: unknown } {
	if (body.includes(FAKE_CLAUDE_ERROR)) {
		return { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Fake error for the UI tests' } } };
	}
	const model = (JSON.parse(body) as { model?: string }).model ?? 'fake';
	const tool = body.includes(FAKE_CLAUDE_SAVE_WITH_PARTS) && !body.includes('"tool_result"');
	return {
		status: 200,
		body: {
			id: 'msg_e2e',
			type: 'message',
			role: 'assistant',
			model,
			content: tool
				? [{ type: 'tool_use', id: 'toolu_e2e', name: 'set_workout', input: FAKE_WORKOUT_WITH_PARTS }]
				: [{ type: 'text', text: FAKE_CLAUDE_REPLY }],
			stop_reason: tool ? 'tool_use' : 'end_turn',
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 }
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
