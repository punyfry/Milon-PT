/**
 * File contents kept in server memory between requests, keyed by Blob
 * pathname and ETag. A listing from Vercel Blob gives every file's current
 * ETag, so a file read right after a listing can be answered from here when
 * its ETag is unchanged, without a download (each download counts as a Blob
 * operation). An entry is only used when the ETag matches, so it is never
 * newer or older than the version it is returned with.
 *
 * Lives as long as the server instance; the oldest entries are dropped once
 * the total size passes `maxChars`.
 */
export class BlobContentCache {
	readonly #entries = new Map<string, { etag: string; body: string }>();
	readonly #maxChars: number;
	#chars = 0;

	constructor(maxChars: number) {
		this.#maxChars = maxChars;
	}

	/** The cached body if its ETag matches `etag`, otherwise null. */
	get(pathname: string, etag: string): { etag: string; body: string } | null {
		const entry = this.#entries.get(pathname);
		if (!entry || !sameEtag(entry.etag, etag)) return null;
		// Move it last, so the oldest entries are the least recently used.
		this.#entries.delete(pathname);
		this.#entries.set(pathname, entry);
		return entry;
	}

	set(pathname: string, etag: string, body: string): void {
		this.delete(pathname);
		// A weak ETag never matches a listing, and a huge body would push out everything else.
		if (!strongEtag(etag) || body.length > this.#maxChars / 4) return;
		this.#entries.set(pathname, { etag, body });
		this.#chars += body.length;
		for (const [oldest, entry] of this.#entries) {
			if (this.#chars <= this.#maxChars) break;
			this.#entries.delete(oldest);
			this.#chars -= entry.body.length;
		}
	}

	delete(pathname: string): void {
		const entry = this.#entries.get(pathname);
		if (!entry) return;
		this.#entries.delete(pathname);
		this.#chars -= entry.body.length;
	}

	get size(): number {
		return this.#entries.size;
	}
}

/** The ETag without surrounding quotes, or null for a weak or empty one. */
function strongEtag(etag: string): string | null {
	if (!etag || etag.startsWith('W/')) return null;
	return etag.replace(/^"(.*)"$/, '$1');
}

/** Listings and downloads may differ in quoting, so compare without the quotes. */
export function sameEtag(a: string, b: string): boolean {
	const sa = strongEtag(a);
	return sa !== null && sa === strongEtag(b);
}
