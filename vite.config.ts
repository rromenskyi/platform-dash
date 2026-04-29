import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		// jsdom for component tests (DOM APIs); node for pure-fn unit
		// tests — picked per-suite via `// @vitest-environment` if a
		// file needs to override.
		environment: 'jsdom',
		// Filter: any *.test.ts and *.spec.ts under src/ runs.
		include: ['src/**/*.{test,spec}.{ts,js}']
	}
});
