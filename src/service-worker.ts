/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * Simple offline support. App files are cached on install. Pages and their
 * data are fetched network-first and cached, so pages you have already opened
 * work offline. API calls and login always go to the network. Landing on the
 * login page clears the cached pages, so nothing is left after sign-out.
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const STATIC = `static-${version}`;
const PAGES = 'pages';
const ASSETS = new Set([...build, ...files]);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(STATIC)
			.then((cache) => cache.addAll([...ASSETS]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	// Cached pages point to the previous version's files, so they are dropped
	// when a new version takes over.
	event.waitUntil(
		caches
			.keys()
			.then((keys) => {
				const old = keys.filter((k) => k !== STATIC && k !== PAGES);
				return Promise.all([...old.map((k) => caches.delete(k)), ...(old.length ? [caches.delete(PAGES)] : [])]);
			})
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

	if (ASSETS.has(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
		return;
	}
	const isPage = request.mode === 'navigate';
	const isData = url.pathname.endsWith('/__data.json');
	if (isPage || isData) event.respondWith(networkFirst(request, isPage));
});

async function networkFirst(request: Request, isPage: boolean): Promise<Response> {
	const cache = await caches.open(PAGES);
	try {
		const response = await fetch(request);
		const path = new URL(response.url || request.url).pathname;
		if (path === '/login' || path.startsWith('/login/')) {
			// Signed out: drop everything cached for the signed-in user.
			await caches.delete(PAGES);
		} else if (response.ok && !response.redirected) {
			await cache.put(request, response.clone());
		}
		return response;
	} catch {
		const hit = await cache.match(request);
		if (hit) return hit;
		if (isPage) return offlinePage();
		return Response.error();
	}
}

function offlinePage(): Response {
	const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ingen anslutning · Milon-PT</title>
<style>
:root{--bg:#f6f6f4;--text:#1c1c1a;--muted:#6b6b66;--accent:#2f6f4f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--text:#ecece8;--muted:#a0a09a;--accent:#5fb38a;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.4}
main{max-width:40rem;margin:0 auto;padding:max(1rem,env(safe-area-inset-top)) 1rem 2rem}
p{color:var(--muted)}a{color:var(--accent)}
</style></head><body><main>
<h1>Ingen anslutning</h1>
<p>Sidan har inte öppnats tidigare på den här enheten och kan inte visas utan nät.</p>
<p>Ett pågående pass ligger kvar på telefonen, och ett pass som väntar på att sparas skickas när nätet är tillbaka.</p>
<p><a href="/">Försök igen</a></p>
</main></body></html>`;
	return new Response(html, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
