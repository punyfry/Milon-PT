import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { e2eStoragePlugin } from './e2e/vite-plugin.ts';

export default defineConfig({
	plugins: [sveltekit(), e2eStoragePlugin()]
});
