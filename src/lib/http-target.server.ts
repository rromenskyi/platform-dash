import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// Which targets the server-side HTTP tester may reach, set by
// DASH_HTTP_TEST_BLOCK:
//   none     — anything (the tool's original behaviour)
//   metadata — (default) deny loopback and link-local, which covers the
//              cloud metadata endpoint 169.254.169.254
//   private  — additionally deny RFC1918 / CGNAT / ULA addresses and
//              in-cluster names (*.svc, *.cluster.local)
// Every address the hostname resolves to is checked. The fetch
// re-resolves, so a DNS-rebinding race remains — acceptable for an
// admin-only tool; this blocks the straightforward SSRF primitive.
export type BlockMode = 'none' | 'metadata' | 'private';

export function blockModeFrom(raw: string | undefined): BlockMode {
	return raw === 'none' || raw === 'private' ? raw : 'metadata';
}

function buildList(mode: BlockMode): BlockList {
	const list = new BlockList();
	if (mode === 'none') return list;
	list.addSubnet('127.0.0.0', 8, 'ipv4');
	list.addSubnet('169.254.0.0', 16, 'ipv4');
	list.addSubnet('0.0.0.0', 8, 'ipv4');
	list.addAddress('::1', 'ipv6');
	list.addAddress('::', 'ipv6');
	list.addSubnet('fe80::', 10, 'ipv6');
	if (mode === 'private') {
		list.addSubnet('10.0.0.0', 8, 'ipv4');
		list.addSubnet('172.16.0.0', 12, 'ipv4');
		list.addSubnet('192.168.0.0', 16, 'ipv4');
		list.addSubnet('100.64.0.0', 10, 'ipv4');
		list.addSubnet('fc00::', 7, 'ipv6');
	}
	return list;
}

const CLUSTER_NAME = /(^|\.)(localhost|svc|cluster\.local)\.?$/i;

type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;
const defaultLookup: Lookup = (host) => lookup(host, { all: true, verbatim: true });

function isBlocked(list: BlockList, address: string): boolean {
	// IPv4-mapped IPv6 (::ffff:169.254.169.254) must match the v4 rules.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
	if (mapped) return list.check(mapped[1], 'ipv4');
	const fam = isIP(address);
	return fam === 4 ? list.check(address, 'ipv4') : fam === 6 ? list.check(address, 'ipv6') : true;
}

// Returns a human-readable reason when the target is denied, else null.
export async function checkTarget(
	url: URL,
	mode: BlockMode,
	resolve: Lookup = defaultLookup
): Promise<string | null> {
	if (mode === 'none') return null;
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (mode === 'private' && CLUSTER_NAME.test(host)) {
		return `in-cluster hostname ${host} is blocked (DASH_HTTP_TEST_BLOCK=${mode})`;
	}
	const list = buildList(mode);
	let addrs: Array<{ address: string }>;
	if (isIP(host)) {
		addrs = [{ address: host }];
	} else {
		try {
			addrs = await resolve(host);
		} catch {
			return null; // let fetch report the DNS failure itself
		}
	}
	const hit = addrs.find((a) => isBlocked(list, a.address));
	return hit ? `${host} → ${hit.address} is blocked (DASH_HTTP_TEST_BLOCK=${mode})` : null;
}
