import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries.
		// Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Node adapter — runs as a long-lived Node process behind
		// Traefik in the cluster. Picked over adapter-static because
		// Auth.js needs server-side session cookies + token refresh.
		adapter: adapter(),
		// Detect a redeploy from a stale tab. The client polls
		// /_app/version.json every 60s; when the hash changes,
		// `updated.current` flips true, and the layout's beforeNavigate
		// hook does a full reload on the next nav so we don't try to
		// hydrate new server data with old client chunks (404'd hashed
		// assets, drifted data shapes, etc).
		version: { pollInterval: 60_000 }
	}
};

export default config;
