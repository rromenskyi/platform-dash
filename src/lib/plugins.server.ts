import { env } from '$env/dynamic/private';
import type { Session } from '@auth/core/types';

// Plugin engine configuration.
//
// DASH_PLUGINS_JSON is a JSON array of
//   { id, title, icon?, element, url, roles? }
// - id:      path segment ([a-z0-9-], ≤32) — page /plugins/<id>/…,
//            API proxy /plugin-api/<id>/…
// - title:   sidebar label;  icon: optional short label/emoji
// - element: custom-element tag defined by the plugin's bundle
//            (served by the plugin at /ui/plugin.js)
// - url:     plugin back end, reached server-side only (http/https)
// - roles:   who sees and may call it; empty/omitted = any signed-in user
//
// Plugins run in dash's origin with the user's access token forwarded
// to their back end: list only plugins you control. Invalid entries are
// skipped with a log line; the rest keep working.

export type Plugin = {
	id: string;
	title: string;
	icon?: string;
	element: string;
	url: string;
	roles: string[];
};

const ID = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
// Custom element names: lowercase, start with a letter, contain a hyphen.
const ELEMENT = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

export function parsePlugins(raw: string | undefined, log: (m: string) => void = console.error): Plugin[] {
	if (!raw?.trim()) return [];
	let list: unknown;
	try {
		list = JSON.parse(raw);
	} catch (e) {
		log(`DASH_PLUGINS_JSON: not valid JSON (${(e as Error).message}); plugins disabled`);
		return [];
	}
	if (!Array.isArray(list)) {
		log('DASH_PLUGINS_JSON: expected a JSON array; plugins disabled');
		return [];
	}
	const out: Plugin[] = [];
	const seen = new Set<string>();
	list.forEach((p: Record<string, unknown>, i) => {
		const why = invalid(p, seen);
		if (why) {
			log(`DASH_PLUGINS_JSON[${i}]: ${why}; skipped`);
			return;
		}
		seen.add(p.id as string);
		out.push({
			id: p.id as string,
			title: p.title as string,
			icon: typeof p.icon === 'string' ? p.icon : undefined,
			element: p.element as string,
			url: (p.url as string).replace(/\/+$/, ''),
			roles: (p.roles as string[] | undefined) ?? []
		});
	});
	return out;
}

function invalid(p: Record<string, unknown>, seen: Set<string>): string | null {
	if (!p || typeof p !== 'object') return 'not an object';
	if (typeof p.id !== 'string' || !ID.test(p.id)) return 'id must match [a-z0-9-]{1,32}';
	if (seen.has(p.id)) return `duplicate id "${p.id}"`;
	if (typeof p.title !== 'string' || !p.title.trim()) return 'title is required';
	if (typeof p.element !== 'string' || !ELEMENT.test(p.element)) return 'element must be a custom-element name (with a hyphen)';
	if (typeof p.url !== 'string') return 'url is required';
	// Fail closed: a malformed roles value must not turn into "everyone".
	if (
		p.roles !== undefined &&
		(!Array.isArray(p.roles) || p.roles.some((r) => typeof r !== 'string' || !r.trim()))
	) {
		return 'roles must be an array of role names (omit or [] for every signed-in user)';
	}
	try {
		const u = new URL(p.url);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'url must be http(s)';
	} catch {
		return 'url is not a valid URL';
	}
	return null;
}

let cached: { raw: string | undefined; plugins: Plugin[] } | null = null;

export function listPlugins(): Plugin[] {
	const raw = env.DASH_PLUGINS_JSON;
	if (!cached || cached.raw !== raw) cached = { raw, plugins: parsePlugins(raw) };
	return cached.plugins;
}

export function canUsePlugin(session: Session | null | undefined, p: Plugin): boolean {
	if (!session?.user) return false;
	if (p.roles.length === 0) return true;
	const mine = session.roles ?? [];
	return p.roles.some((r) => mine.includes(r));
}

export function visiblePlugins(session: Session | null | undefined): Plugin[] {
	return listPlugins().filter((p) => canUsePlugin(session, p));
}

export function findPlugin(id: string): Plugin | undefined {
	return listPlugins().find((p) => p.id === id);
}

// Keep plugin redirects inside the proxy. Locations on the plugin —
// "<plugin url>/x", or "/<plugin url path>/x" when the url has a path —
// become "<base>/x"; other absolute-path locations are taken as relative
// to the plugin root; relative and external ones pass through.
export function rewriteLocation(loc: string, pluginUrl: string, base: string): string {
	if (loc === pluginUrl || loc.startsWith(pluginUrl + '/') || loc.startsWith(pluginUrl + '?')) {
		return base + (loc.slice(pluginUrl.length) || '/');
	}
	if (loc.startsWith('/') && !loc.startsWith('//')) {
		const prefix = new URL(pluginUrl).pathname.replace(/\/+$/, '');
		if (prefix && (loc === prefix || loc.startsWith(prefix + '/') || loc.startsWith(prefix + '?'))) {
			return base + (loc.slice(prefix.length) || '/');
		}
		return base + loc;
	}
	return loc;
}
