import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Functions run in Stockholm, next to the Blob store; every page load makes
		// many storage calls, so the distance between them adds up.
		adapter: adapter({ regions: ['arn1'] }),
		// Content-Security-Policy. SvelteKit adds hashes/nonces for its own inline
		// scripts. The sign-in form redirects to Google, hence form-action.
		// Inline styles are needed for Svelte's style: directive.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'manifest-src': ['self'],
				'worker-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none'],
				'form-action': ['self', 'https://accounts.google.com']
			}
		},
		typescript: {
			// Also type-check the import script and the vitest config.
			config: (tsconfig) => {
				tsconfig.include.push('../scripts/**/*.ts', '../vitest.config.ts');
			}
		}
	}
};

export default config;
