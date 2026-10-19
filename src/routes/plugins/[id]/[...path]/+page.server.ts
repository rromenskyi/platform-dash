import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { findPlugin, canUsePlugin } from '$lib/plugins.server';
import { accessibleNamespaces } from '$lib/authz';
import { defaultCluster } from '$lib/clusters.server';

// Plugin host page: /plugins/<id> and any subpath (deep links). The
// browser mounts the plugin's custom element and hands it `context`;
// the plugin talks to its back end through /plugin-api/<id>/….
export const load: PageServerLoad = async ({ params, locals }) => {
	const session = await locals.auth();
	if (!session?.user) throw redirect(303, '/');
	const plugin = findPlugin(params.id);
	if (!plugin) throw error(404, `Unknown plugin "${params.id}"`);
	if (!canUsePlugin(session, plugin)) throw error(403, 'You do not have access to this plugin');

	const cluster = defaultCluster();
	return {
		plugin: { id: plugin.id, title: plugin.title, element: plugin.element },
		// Static part of the plugin context; theme/path are filled in the
		// browser and kept current.
		ctx: {
			user: {
				sub: session.user.id ?? '',
				name: session.user.name ?? '',
				email: session.user.email ?? ''
			},
			roles: session.roles ?? [],
			namespaces: accessibleNamespaces(session, cluster),
			cluster
		}
	};
};
