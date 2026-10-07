import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { beginRequest, requestStats, storageFor } from '$lib/server/storage';
import { BlobUserStorage } from '$lib/server/storage/blob';
import { RequestStorage } from '$lib/server/storage/request';
import { serverTiming, serverTimingHeader } from './timing';

const user = { id: 'u1', email: 'a@example.com', name: null };
/** Only `user` matters to storage; the Auth.js helpers on locals are not used here. */
const localsFor = (u: App.Locals['user']) => ({ user: u }) as App.Locals;

afterEach(() => {
	delete env.BLOB_READ_WRITE_TOKEN;
	vi.restoreAllMocks();
});

describe('request storage scope', () => {
	it('gives one shared storage per request, and plain storage outside a request', () => {
		env.BLOB_READ_WRITE_TOKEN = 'test-token';
		const locals = localsFor(user);
		expect(storageFor(locals)).not.toBeInstanceOf(RequestStorage);
		beginRequest(locals, { shareReads: true });
		const first = storageFor(locals);
		expect(first).toBeInstanceOf(RequestStorage);
		expect(storageFor(locals)).toBe(first);
		expect(storageFor(localsFor(user))).not.toBe(first);
		expect(requestStats(locals)).toEqual({ reads: 0, lists: 0, writes: 0, shared: 0, ms: 0 });
	});

	it('still requires a signed-in user', () => {
		const locals = localsFor(null);
		beginRequest(locals, { shareReads: true });
		expect(() => storageFor(locals)).toThrow();
	});
});

describe('serverTiming', () => {
	it('formats total and storage time', () => {
		expect(serverTimingHeader(12.4, null)).toBe('total;dur=12');
		expect(serverTimingHeader(250, { reads: 3, lists: 1, writes: 0, shared: 2, ms: 180.6 })).toBe(
			'total;dur=250, storage;desc="3 reads, 1 lists, 0 writes, 2 shared";dur=181'
		);
	});

	function event(method: string): RequestEvent {
		return {
			locals: { user },
			request: new Request('https://example.com/pass/benpass', { method }),
			route: { id: '/pass/[slug]' },
			isDataRequest: true
		} as unknown as RequestEvent;
	}

	it('adds the header and logs the route pattern, not the URL', async () => {
		env.BLOB_READ_WRITE_TOKEN = 'test-token';
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const response = await serverTiming({
			event: event('GET'),
			resolve: async (e: RequestEvent) => {
				const storage = storageFor(e.locals) as RequestStorage;
				storage.stats.reads = 2; // stands in for real reads
				return new Response('ok');
			}
		});
		expect(response.headers.get('Server-Timing')).toMatch(/^total;dur=\d+, storage;desc="2 reads, 0 lists, 0 writes, 0 shared";dur=\d+$/);
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0][0]).toMatch(/^\[timing\] GET \/pass\/\[slug\] \(data\) 200 \d+ ms, storage \d+ ms \(2 reads/);
		expect(log.mock.calls[0][0]).not.toContain('benpass');
	});

	it.each([
		['GET', 1],
		['POST', 2]
	])('%s requests make %i storage call(s) for two identical reads', async (method, calls) => {
		env.BLOB_READ_WRITE_TOKEN = 'test-token';
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const read = vi.spyOn(BlobUserStorage.prototype, 'readJson').mockResolvedValue(null);
		await serverTiming({
			event: event(method),
			resolve: async (e: RequestEvent) => {
				await storageFor(e.locals).readJson('profile.json');
				await storageFor(e.locals).readJson('profile.json');
				return new Response('ok');
			}
		});
		expect(read).toHaveBeenCalledTimes(calls);
	});

	it('skips the log when storage was not used', async () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const response = await serverTiming({ event: event('GET'), resolve: async () => new Response('ok') });
		expect(response.headers.get('Server-Timing')).toMatch(/^total;dur=\d+$/);
		expect(log).not.toHaveBeenCalled();
	});

	it('names requests without a route', async () => {
		env.BLOB_READ_WRITE_TOKEN = 'test-token';
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const ev = { ...event('GET'), route: { id: null }, isDataRequest: false } as unknown as RequestEvent;
		await serverTiming({
			event: ev,
			resolve: async (e: RequestEvent) => {
				(storageFor(e.locals) as RequestStorage).stats.lists = 1;
				return new Response('ok');
			}
		});
		expect(log.mock.calls[0][0]).toMatch(/^\[timing\] GET \(no route\) 200 /);
	});

	it('lets errors from later hooks (e.g. the guard redirect) pass through without logging', async () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		const redirect = { status: 303, location: '/login' };
		await expect(
			serverTiming({
				event: event('GET'),
				resolve: async () => {
					throw redirect;
				}
			})
		).rejects.toBe(redirect);
		expect(log).not.toHaveBeenCalled();
	});

		it('leaves responses with immutable headers alone', async () => {
		const immutable = Response.redirect('https://example.com/', 302);
		const response = await serverTiming({ event: event('GET'), resolve: async () => immutable });
		expect(response).toBe(immutable);
	});
});
