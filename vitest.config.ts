import { defineConfig } from 'vitest/config';

const path = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		alias: {
			$lib: path('./src/lib'),
			// SvelteKit's virtual modules don't exist outside the Vite plugin.
			'$env/dynamic/private': path('./src/test/env-private.ts'),
			'$app/environment': path('./src/test/app-environment.ts')
		},
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/test/**', 'src/**/*.d.ts']
		}
	}
});
