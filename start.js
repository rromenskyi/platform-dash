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
import { KubeConfig, Exec, CoreV1Api } from '@kubernetes/client-node';
import { randomBytes } from 'node:crypto';

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
function canWrite(session, cluster, namespace) {
	const roles = session?.roles ?? [];
	if (roles.includes('platform_admin')) return true;
	if (cluster && roles.includes(`cluster_${cluster}_admin`)) return true;
	if (namespace && roles.includes(`namespace_${namespace}_admin`)) return true;
	return false;
}

// ── WS bridge ────────────────────────────────────────────────────────
const STDIN = 0;
const STDOUT = 1;
const STDERR = 2;
const ERR = 3;
const RESIZE = 4;
// Out-of-band metadata frames (e.g. ephemeral pod name once it's
// running). The pod-exec bridge doesn't use this channel; cloudshell
// does so the UI can show the operator what was created.
const META = 5;

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

// k8s name checks (mirror src/lib/k8s-names.ts). Exec.exec() interpolates
// ns/pod verbatim into the API path — a decoded `../` in either would
// let a namespace-scoped admin open a shell in another namespace.
const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const isNamespaceName = (s) => typeof s === 'string' && DNS1123_LABEL.test(s);
const isObjectName = (s) => typeof s === 'string' && s.length <= 253 && DNS1123_SUBDOMAIN.test(s);

async function handleExecUpgrade(req, socket, head, params) {
	if (!originAllowed(req)) {
		socket.destroy();
		return;
	}
	if (!isNamespaceName(params.ns) || !isObjectName(params.pod)) {
		socket.destroy();
		return;
	}
	if (!clusters.find((c) => c.name === params.cluster)) {
		socket.destroy();
		return;
	}
	const session = await getSessionFromUpgrade(req);
	// Pass ns so a namespace_<ns>_admin can shell into pods in their
	// own namespace; cluster-wide write or platform admin still pass
	// without the ns arg matching.
	if (!canWrite(session, params.cluster, params.ns)) {
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

	// Without an 'error' listener, a protocol error (oversized frame,
	// bad opcode, socket reset) is an unhandled EventEmitter error and
	// takes the whole process down. Registered before any await.
	ws.on('error', (err) => {
		console.error('ws error', err?.message ?? err);
		closeAll();
	});

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

// ── Cloudshell: ephemeral pod per session ─────────────────────────────
// Spins up a one-shot pod with `bitnami/kubectl` (kubectl + bash + the
// usual crew), exec's into it, deletes on close. Auth is global
// platform_admin only — the pod runs under the dash service account
// and thus has the dash's k8s permissions, so giving cluster-scoped
// roles a cloudshell would silently elevate them.
const CLOUDSHELL_NAMESPACE = process.env.CLOUDSHELL_NAMESPACE ?? 'platform';
const CLOUDSHELL_IMAGE = process.env.CLOUDSHELL_IMAGE ?? 'bitnami/kubectl:latest';
const CLOUDSHELL_SA = process.env.CLOUDSHELL_SERVICE_ACCOUNT ?? 'platform-dash';
const CLOUDSHELL_TTL_SECONDS = Number(process.env.CLOUDSHELL_TTL_SECONDS ?? 4 * 60 * 60);
const CLOUDSHELL_BOOT_TIMEOUT_MS = 30_000;

function sanitizeUserForLabel(s) {
	return (s || 'anon').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'anon';
}

async function createCloudshellPod(cluster, owner) {
	const kc = getKubeConfig(cluster);
	const k = kc.makeApiClient(CoreV1Api);
	const safeOwner = sanitizeUserForLabel(owner);
	const sessionId = randomBytes(4).toString('hex');
	const name = `cloudshell-${safeOwner}-${sessionId}`.slice(0, 63);
	const body = {
		metadata: {
			name,
			namespace: CLOUDSHELL_NAMESPACE,
			labels: {
				app: 'cloudshell',
				'platform-dash/owner': safeOwner,
				'platform-dash/session': sessionId
			}
		},
		spec: {
			serviceAccountName: CLOUDSHELL_SA,
			restartPolicy: 'Never',
			activeDeadlineSeconds: CLOUDSHELL_TTL_SECONDS,
			terminationGracePeriodSeconds: 5,
			automountServiceAccountToken: true,
			containers: [
				{
					name: 'shell',
					image: CLOUDSHELL_IMAGE,
					command: ['sleep', String(CLOUDSHELL_TTL_SECONDS)],
					tty: true,
					stdin: true,
					resources: {
						requests: { cpu: '50m', memory: '64Mi' },
						limits: { cpu: '500m', memory: '512Mi' }
					}
				}
			]
		}
	};
	await k.createNamespacedPod({ namespace: CLOUDSHELL_NAMESPACE, body });
	const deadline = Date.now() + CLOUDSHELL_BOOT_TIMEOUT_MS;
	for (;;) {
		const got = await k.readNamespacedPod({ name, namespace: CLOUDSHELL_NAMESPACE });
		const phase = got.status?.phase;
		if (phase === 'Running') return { name, namespace: CLOUDSHELL_NAMESPACE };
		if (phase === 'Failed' || phase === 'Succeeded') {
			throw new Error(`cloudshell pod entered ${phase} before becoming Running`);
		}
		if (Date.now() > deadline) {
			throw new Error(`cloudshell pod did not reach Running within ${CLOUDSHELL_BOOT_TIMEOUT_MS}ms (phase=${phase ?? '?'})`);
		}
		await new Promise((r) => setTimeout(r, 500));
	}
}

async function deleteCloudshellPod(cluster, namespace, name) {
	try {
		const kc = getKubeConfig(cluster);
		const k = kc.makeApiClient(CoreV1Api);
		await k.deleteNamespacedPod({ name, namespace, gracePeriodSeconds: 0 });
	} catch (err) {
		console.error('cloudshell pod cleanup failed', name, err);
	}
}

async function handleCloudshellUpgrade(req, socket, head, params) {
	if (!originAllowed(req)) {
		socket.destroy();
		return;
	}
	if (!clusters.find((c) => c.name === params.cluster)) {
		socket.destroy();
		return;
	}
	const session = await getSessionFromUpgrade(req);
	// Global canWrite only — cluster-scoped admins don't get a
	// cloudshell because the pod runs as the dash SA. See note above.
	if (!canWrite(session)) {
		socket.destroy();
		return;
	}
	const owner = session?.user?.email ?? session?.user?.name ?? 'unknown';

	const ws = await new Promise((resolve) =>
		wss.handleUpgrade(req, socket, head, (s) => resolve(s))
	);

	const baseAudit = {
		user: owner,
		roles: session?.roles ?? [],
		cluster: params.cluster,
		action: 'cloudshell',
		target: { kind: 'Pod', namespace: CLOUDSHELL_NAMESPACE }
	};
	const start = performance.now();

	let pod = null;
	let upstream = null;
	let closed = false;
	const stdin = new PassThrough();

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
		if (pod) {
			deleteCloudshellPod(params.cluster, pod.namespace, pod.name);
		}
	}

	ws.on('error', (err) => {
		console.error('ws error', err?.message ?? err);
		closeAll();
	});

	ws.on('close', () => {
		const ms = Math.round(performance.now() - start);
		audit({
			...baseAudit,
			target: { ...baseAudit.target, name: pod?.name },
			outcome: 'ok',
			message: 'session closed',
			durationMs: ms
		});
		closeAll();
	});

	try {
		pod = await createCloudshellPod(params.cluster, owner);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		audit({ ...baseAudit, outcome: 'error', message: `pod create failed: ${msg}`, durationMs: Math.round(performance.now() - start) });
		try {
			ws.send(prefixed(ERR, Buffer.from(`pod create failed: ${msg}`, 'utf8')));
			ws.close();
		} catch {}
		try {
			stdin.end();
		} catch {}
		return;
	}

	audit({
		...baseAudit,
		target: { ...baseAudit.target, name: pod.name },
		outcome: 'ok',
		message: 'pod created',
		durationMs: Math.round(performance.now() - start)
	});
	try {
		ws.send(prefixed(META, Buffer.from(JSON.stringify({ pod: pod.name, namespace: pod.namespace }), 'utf8')));
	} catch {}

	const stdout = mkWriter(ws, STDOUT);
	const stderr = mkWriter(ws, STDERR);

	try {
		const exec = new Exec(getKubeConfig(params.cluster));
		upstream = await exec.exec(
			pod.namespace,
			pod.name,
			'shell',
			['bash', '-i'],
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
		audit({
			...baseAudit,
			target: { ...baseAudit.target, name: pod.name },
			outcome: 'error',
			message: `exec failed: ${msg}`,
			durationMs: Math.round(performance.now() - start)
		});
		try {
			ws.send(prefixed(ERR, Buffer.from(`exec failed: ${msg}`, 'utf8')));
			ws.close();
		} catch {}
		try {
			stdin.end();
		} catch {}
		return;
	}

	ws.on('message', (raw) => {
		const buf = raw;
		if (!Buffer.isBuffer(buf) || buf.length === 0) return;
		const prefix = buf[0];
		const body = buf.subarray(1);
		if (prefix === STDIN) {
			stdin.write(body);
		} else if (prefix === RESIZE && upstream) {
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
}

// On boot, sweep any cloudshell pods left over from a previous dash
// process so they don't pile up across restarts. Best-effort — if the
// list/delete calls fail (RBAC, apiserver hiccup) we just log and
// move on; activeDeadlineSeconds on the pod spec is the backstop.
async function sweepOrphanCloudshells() {
	for (const c of clusters) {
		try {
			const k = getKubeConfig(c.name).makeApiClient(CoreV1Api);
			const list = await k.listNamespacedPod({
				namespace: CLOUDSHELL_NAMESPACE,
				labelSelector: 'app=cloudshell'
			});
			for (const p of list.items) {
				const name = p.metadata?.name;
				if (!name) continue;
				try {
					await k.deleteNamespacedPod({ name, namespace: CLOUDSHELL_NAMESPACE, gracePeriodSeconds: 0 });
					console.log(`cloudshell sweep: deleted orphan ${c.name}/${name}`);
				} catch (err) {
					console.error(`cloudshell sweep: delete ${c.name}/${name} failed`, err);
				}
			}
		} catch (err) {
			console.error(`cloudshell sweep on ${c.name} failed`, err);
		}
	}
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
	// `handle*Upgrade` is async; the upgrade event listener can't await
	// it, so an unhandled rejection inside would otherwise hit the
	// process-wide `unhandledRejection` and crash node 22 in strict
	// mode. Catch + destroy as a last resort.
	const onFail = (err, label) => {
		console.error(`${label} failed`, err);
		try {
			socket.destroy();
		} catch {}
	};
	// URL parsing + decodeURIComponent throw synchronously (`/ws/cloudshell/%`
	// → URIError) — outside the .catch() below, that would be an uncaught
	// exception that kills the process, pre-auth.
	try {
		const u = new URL(req.url, 'http://localhost');
		const exec = /^\/ws\/exec\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(u.pathname);
		if (exec) {
			handleExecUpgrade(req, socket, head, {
				cluster: decodeURIComponent(exec[1]),
				ns: decodeURIComponent(exec[2]),
				pod: decodeURIComponent(exec[3]),
				container: u.searchParams.get('container') ?? undefined,
				shell: u.searchParams.get('shell') ?? undefined
			}).catch((err) => onFail(err, 'handleExecUpgrade'));
			return;
		}
		const cloud = /^\/ws\/cloudshell\/([^/?#]+)$/.exec(u.pathname);
		if (cloud) {
			handleCloudshellUpgrade(req, socket, head, {
				cluster: decodeURIComponent(cloud[1])
			}).catch((err) => onFail(err, 'handleCloudshellUpgrade'));
			return;
		}
		socket.destroy();
	} catch (err) {
		onFail(err, 'upgrade dispatch');
	}
});

server.listen(port, () => {
	console.log(
		`platform-dash listening on :${port} (with /ws/exec/* and /ws/cloudshell/* WS bridges)`
	);
	sweepOrphanCloudshells();
});
