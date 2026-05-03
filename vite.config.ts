import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

// Build-time identity: CI passes GIT_SHA via Docker build-arg →
// Dockerfile ENV → here. Local `npm run build` falls back to the
// current HEAD; `npm run dev` (or test) gets the literal "dev".
function buildSha(): string {
	if (process.env.GIT_SHA) return process.env.GIT_SHA;
	try {
		return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'dev';
	}
}

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__BUILD_SHA__: JSON.stringify(buildSha()),
		__BUILD_TIME__: JSON.stringify(new Date().toISOString())
	},
	test: {
		// jsdom for component tests (DOM APIs); node for pure-fn unit
		// tests — picked per-suite via `// @vitest-environment` if a
		// file needs to override.
		environment: 'jsdom',
		// Filter: any *.test.ts and *.spec.ts under src/ runs.
		include: ['src/**/*.{test,spec}.{ts,js}']
	}
});
