import type { Handle } from '@sveltejs/kit';
import { beginRequest, requestStats, type StorageStats } from '$lib/server/storage';

/** `Server-Timing` value: total time and time spent waiting on storage, visible in the browser's dev tools. */
export function serverTimingHeader(totalMs: number, stats: StorageStats | null): string {
	const parts = [`total;dur=${totalMs.toFixed(0)}`];
	if (stats) {
		const desc = `${stats.reads} reads, ${stats.lists} lists, ${stats.writes} writes, ${stats.shared} shared`;
		parts.push(`storage;desc="${desc}";dur=${stats.ms.toFixed(0)}`);
	}
	return parts.join(', ');
}

/**
 * Measures each request and how much of it is spent on storage. Adds a
 * `Server-Timing` header and logs one line per request that used storage, so
 * slow views can be traced in the Vercel logs. The log names the route
 * pattern (`/pass/[slug]`), not the URL, to keep workout names out of it.
 * Also starts the request's storage scope; GET requests share identical
 * reads (see `RequestStorage`).
 */
export const serverTiming: Handle = async ({ event, resolve }) => {
	const start = performance.now();
	beginRequest(event.locals, { shareReads: event.request.method === 'GET' });
	const response = await resolve(event);
	const total = performance.now() - start;
	const stats = requestStats(event.locals);
	try {
		response.headers.append('Server-Timing', serverTimingHeader(total, stats));
	} catch {
		// Responses with immutable headers (e.g. redirects from fetch) are left as is.
	}
	if (stats && stats.reads + stats.lists + stats.writes + stats.shared > 0) {
		const route = `${event.route.id ?? '(no route)'}${event.isDataRequest ? ' (data)' : ''}`;
		console.info(
			`[timing] ${event.request.method} ${route} ${response.status} ${total.toFixed(0)} ms, storage ${stats.ms.toFixed(0)} ms ` +
				`(${stats.reads} reads, ${stats.lists} lists, ${stats.writes} writes, ${stats.shared} shared)`
		);
	}
	return response;
};
