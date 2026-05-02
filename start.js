// Custom production entry. Wraps adapter-node's `handler` in a real
// http.Server so we can mount a WebSocket upgrade listener for
// /ws/exec/<cluster>/<ns>/<pod>?container=…&shell=sh|bash. SvelteKit
// doesn't model WS in its route surface; this is the canonical
// adapter-node escape hatch.
//
// Replaces `node build` (which runs build/index.js directly).
// Production Dockerfile CMD points here instead.
//
// Self-contained: imports only from node_modules (no fragile lookups
// into hashed SvelteKit chunk filenames). Cluster config is parsed
// from DASH_CLUSTERS_JSON the same way clusters.server.ts does it.

import { handler } from './build/handler.js';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { WebSocketServer } from 'ws';
import { KubeConfig, Exec } from '@kubernetes/client-node';

const port = Number(process.env.PORT ?? 3000);

// ── Cluster registry (mirrors src/lib/clusters.server.ts) ────────────
function loadClusterConfigs() {
	const raw = process.env.DASH_CLUSTERS_JSON;
	if (!raw) return [{ name: 'local', inCluster: true }];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed) || parsed.length === 0) {
			return [{ name: 'local', inCluster: true }];
		}
		const out = new Map();
		for (const c of parsed) if (c?.name) out.set(c.name, c);
		const arr = Array.from(out.values());
		return arr.length ? arr : [{ name: 'local', inCluster: true }];
	} catch {
		return [{ name: 'local', inCluster: true }];
	}
}
const clusters = loadClusterConfigs();
const kcCache = new Map();
function getKubeConfig(name) {
	const c = clusters.find((x) => x.name === name);
	if (!c) throw new Error(`unknown cluster: ${name}`);
	const cached = kcCache.get(name);
	if (cached) return cached;
	const kc = new KubeConfig();
	if (c.inCluster) {
		try {
			kc.loadFromCluster();
		} catch {
			kc.loadFromDefault();
		}
	} else if (c.kubeconfigPath) {
		kc.loadFromFile(c.kubeconfigPath);
		if (c.kubeconfigContext) kc.setCurrentContext(c.kubeconfigContext);
	} else {
		kc.loadFromDefault();
	}
	kcCache.set(name, kc);
	return kc;
}

// ── Audit ────────────────────────────────────────────────────────────
// Same JSON-line shape audit.server.ts emits. The dash's in-memory
// audit ring lives in the SvelteKit module scope and we can't reach
// into it from here without fragile chunk imports — but stdout-going
// to Loki/kubectl logs is the durable channel anyway.
function audit(ev) {
	try {
		console.log(JSON.stringify({ kind: 'audit', ts: new Date().toISOString(), ...ev }));
	} catch {
		/* */
	}
}

// ── Auth: loopback to /auth/session ──────────────────────────────────
async function getSessionFromUpgrade(req) {
	const cookie = req.headers.cookie;
	if (!cookie) return null;
	try {
		const res = await fetch(`http://127.0.0.1:${port}/auth/session`, {
			headers: { cookie }
		});
		if (!res.ok) return null;
		const text = await res.text();
		if (!text) return null;
		const j = JSON.parse(text);
		return j && j.user ? j : null;
	} catch {
		return null;
	}
}

// canWrite — same role rules as authz.ts. Duplicated here so this
// bootstrap doesn't depend on hashed SvelteKit chunks.
function canWrite(session, cluster) {
	const roles = session?.roles ?? [];
	if (roles.includes('platform_admin')) return true;
	if (cluster && roles.includes(`cluster_${cluster}_admin`)) return true;
	return false;
}

// ── WS bridge ────────────────────────────────────────────────────────
const STDIN = 0;
const STDOUT = 1;
const STDERR = 2;
const ERR = 3;
const RESIZE = 4;

function prefixed(channel, body) {
	const out = Buffer.alloc(body.length + 1);
	out[0] = channel;
	body.copy(out, 1);
	return out;
}

function mkWriter(ws, channel) {
	return {
		write(chunk) {
			const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
			try {
				ws.send(prefixed(channel, buf));
			} catch {
				/* */
			}
			return true;
		},
		end() {},
		on() {
			return this;
		},
		once() {
			return this;
		},
		emit() {
			return true;
		},
		removeListener() {
			return this;
		}
	};
}

// 1 MB cap on incoming WS frames. Terminal keystrokes are bytes,
// pasted blocks rarely exceed a few KB; 1 MB leaves headroom for
// "operator pasted a cert" without giving an attacker a 100 MB
// memory amplification primitive (the `ws` library default).
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 * 1024 * 1024 });

// Same-origin Origin check on the WS upgrade. SameSite=Lax cookies
// already block cross-origin auth, but defence-in-depth — refuse
// the upgrade if the Origin header is set and doesn't match the
// request's Host. Missing Origin (curl, native ws clients) is
// allowed since cookies still gate auth.
function originAllowed(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	try {
		const o = new URL(origin);
		const host = req.headers.host;
		if (!host) return false;
		return o.host === host;
	} catch {
		return false;
	}
}

async function handleExecUpgrade(req, socket, head, params) {
	if (!originAllowed(req)) {
		socket.destroy();
		return;
	}
	if (!clusters.find((c) => c.name === params.cluster)) {
		socket.destroy();
		return;
	}
	const session = await getSessionFromUpgrade(req);
	if (!canWrite(session, params.cluster)) {
		socket.destroy();
		return;
	}
	const shell = params.shell === 'bash' ? 'bash' : 'sh';
	const containerArg = params.container ?? '';

	const ws = await new Promise((resolve) =>
		wss.handleUpgrade(req, socket, head, (s) => resolve(s))
	);

	const baseAudit = {
		user: session?.user?.email ?? session?.user?.name ?? 'unknown',
		roles: session?.roles ?? [],
		cluster: params.cluster,
		action: 'pod-exec',
		target: {
			kind: 'Pod',
			namespace: params.ns,
			name: params.pod,
			container: containerArg || undefined,
			shell
		}
	};
	const start = performance.now();

	const stdin = new PassThrough();
	const stdout = mkWriter(ws, STDOUT);
	const stderr = mkWriter(ws, STDERR);

	let upstream = null;
	let closed = false;

	function closeAll() {
		if (closed) return;
		closed = true;
		try {
			stdin.end();
		} catch {}
		try {
			upstream?.close();
		} catch {}
		try {
			ws.close();
		} catch {}
	}

	try {
		const exec = new Exec(getKubeConfig(params.cluster));
		upstream = await exec.exec(
			params.ns,
			params.pod,
			containerArg,
			[shell, '-i'],
			stdout,
			stderr,
			stdin,
			true,
			(status) => {
				const m =
					status?.status === 'Success'
						? null
						: `\r\n[exec ended: ${status?.message ?? status?.reason ?? 'unknown'}]\r\n`;
				if (m) {
					try {
						ws.send(prefixed(STDERR, Buffer.from(m, 'utf8')));
					} catch {}
				}
				closeAll();
			}
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		audit({ ...baseAudit, outcome: 'error', message: msg, durationMs: 0 });
		try {
			ws.send(prefixed(ERR, Buffer.from(`exec failed: ${msg}`, 'utf8')));
			ws.close();
		} catch {}
		// Tear down stdin explicitly — closeAll() bails when the ws
		// hasn't fired its close event yet. Without this, repeated
		// auth-failure connects leak PassThrough buffers.
		try {
			stdin.end();
		} catch {}
		return;
	}

	audit({ ...baseAudit, outcome: 'ok', message: 'session opened', durationMs: 0 });

	ws.on('message', (raw) => {
		const buf = raw;
		if (!Buffer.isBuffer(buf) || buf.length === 0) return;
		const prefix = buf[0];
		const body = buf.subarray(1);
		if (prefix === STDIN) {
			stdin.write(body);
		} else if (prefix === RESIZE && upstream) {
			// Validate JSON shape before forwarding to k8s — malformed
			// frames otherwise close the upstream silently and the
			// operator sees a vague "[exec ended]".
			try {
				const obj = JSON.parse(body.toString('utf8'));
				if (
					typeof obj?.Width !== 'number' ||
					typeof obj?.Height !== 'number' ||
					!Number.isFinite(obj.Width) ||
					!Number.isFinite(obj.Height)
				) {
					ws.send(prefixed(ERR, Buffer.from('bad RESIZE frame', 'utf8')));
					return;
				}
				upstream.send(Buffer.concat([Buffer.from([RESIZE]), body]));
			} catch {
				try {
					ws.send(prefixed(ERR, Buffer.from('RESIZE frame is not JSON', 'utf8')));
				} catch {}
			}
		}
	});

	ws.on('close', () => {
		const ms = Math.round(performance.now() - start);
		audit({ ...baseAudit, outcome: 'ok', message: 'session closed', durationMs: ms });
		closeAll();
	});
}

// ── HTTP + upgrade wiring ────────────────────────────────────────────
const server = http.createServer((req, res) => {
	handler(req, res);
});

server.on('upgrade', (req, socket, head) => {
	if (!req.url) {
		socket.destroy();
		return;
	}
	const u = new URL(req.url, 'http://localhost');
	const m = /^\/ws\/exec\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(u.pathname);
	if (!m) {
		socket.destroy();
		return;
	}
	// `handleExecUpgrade` is async; the upgrade event listener can't
	// await it, so an unhandled rejection inside would otherwise hit
	// the process-wide `unhandledRejection` and crash node 22 in
	// strict mode. Catch + destroy as a last resort.
	handleExecUpgrade(req, socket, head, {
		cluster: decodeURIComponent(m[1]),
		ns: decodeURIComponent(m[2]),
		pod: decodeURIComponent(m[3]),
		container: u.searchParams.get('container') ?? undefined,
		shell: u.searchParams.get('shell') ?? undefined
	}).catch((err) => {
		console.error('handleExecUpgrade failed', err);
		try {
			socket.destroy();
		} catch {
			/* */
		}
	});
});

server.listen(port, () => {
	console.log(`platform-dash listening on :${port} (with /ws/exec/* WS bridge)`);
});
