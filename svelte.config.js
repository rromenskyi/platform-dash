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
		adapter: adapter()
	}
};

export default config;
