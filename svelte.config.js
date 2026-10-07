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
		adapter: adapter(),
		// Content-Security-Policy. SvelteKit lägger själv till hashar för sina
		// inline-skript. Inloggningsformuläret skickas vidare till Google, därav
		// form-action. Inline-stilar behövs för Sveltes style:-direktiv.
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
			// Typkontrollera även importskriptet och vitest-konfigen.
			config: (tsconfig) => {
				tsconfig.include.push('../scripts/**/*.ts', '../vitest.config.ts');
			}
		}
	}
};

export default config;
