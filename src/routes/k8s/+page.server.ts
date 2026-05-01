import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { defaultCluster } from '$lib/clusters.server';

// Plain /k8s lands the user on the default cluster's overview. The
// cluster name is part of the URL from there on, so deep links and
// the cluster selector stay consistent.
export const load: PageServerLoad = ({ url }) => {
	const target = `/k8s/${defaultCluster()}${url.search}`;
	throw redirect(303, target);
};
