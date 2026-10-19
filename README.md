# platform-dash

Operator dashboard for Kubernetes / k3s: workloads, nodes (CPU, memory,
disk), logs, pod and cloud shells, secrets, CRDs, events and an incident
snapshot. Login is OIDC with any provider (Zitadel, Keycloak, Authentik,
Dex, …); what each user can see and do follows roles from your IdP.

## Install on a k3s cluster

You need: a k3s (or any Kubernetes) cluster with an ingress controller —
k3s ships Traefik — a DNS name pointing at it, and an OIDC provider.

**1. Register an OIDC client** in your IdP:

- type: confidential web app, authorization code flow (+ refresh token)
- redirect URI: `https://dash.example.com/auth/callback/oidc`
- make the user's roles/groups appear in the **id_token** (Keycloak/
  Authentik/Dex: a `groups` mapper; Zitadel: "assert roles on
  authentication")

**2. Create the roles** the dashboard looks for and assign them:

| Role | Grants |
|---|---|
| `platform_admin` | everything, on every cluster |
| `platform_sre` | read everything, no changes |
| `cluster_<name>_admin` / `cluster_<name>_sre` | the same, for one cluster |
| `namespace_<ns>_admin` / `namespace_<ns>_sre` | one namespace only |

**3. Install the chart:**

```sh
git clone https://github.com/rromenskyi/platform-dash
helm install dash platform-dash/deploy/helm/platform-dash \
  --namespace platform-dash --create-namespace \
  --set url=https://dash.example.com \
  --set auth.issuer=https://id.example.com \
  --set auth.clientId=platform-dash \
  --set auth.clientSecret=<client secret> \
  --set auth.rolesClaim=groups
```

Open `https://dash.example.com` and sign in.

Common settings (see [`values.yaml`](deploy/helm/platform-dash/values.yaml)
for all of them):

| Value | Default | |
|---|---|---|
| `auth.rolesClaim` | `groups` | id_token claim with roles; dot path allowed (`realm_access.roles`). Zitadel: `urn:zitadel:iam:org:project:roles` |
| `auth.providerName` | `SSO` | sign-in button label |
| `auth.existingSecret` | — | use your own Secret with `AUTH_SECRET` + `AUTH_OIDC_CLIENT_SECRET` |
| `rbac.readOnly` | `false` | `true` binds the built-in `view` role (no Secrets) + nodes/CRDs/metrics; write actions and shells are then refused by the cluster |
| `ingress.tls` | `[]` | e.g. `[{secretName: dash-tls}]` (cert-manager, or k3s Traefik's default cert) |
| `grafanaUrl` | — | deeplink to your Grafana |
| `httpTestBlock` | `metadata` | HTTP tester target guard: `none` / `metadata` / `private` |

Node CPU/memory "actual" bars need metrics-server (k3s ships it). Disk
bars read the kubelet stats via the API server and need full RBAC.

Upgrade with `helm upgrade dash platform-dash/deploy/helm/platform-dash
--reuse-values`; the session key is generated once and kept.

## Plugins

Other services can add pages to the dashboard. A plugin is a back end
you run plus a custom element it serves; the dashboard lists it in the
sidebar, mounts the element inside its layout and proxies the
element's API calls with the user's OIDC access token.

Configure with `DASH_PLUGINS_JSON` (Helm: `plugins`):

```json
[{ "id": "projects", "title": "Projects", "icon": "📦",
   "element": "x-projects", "url": "http://projects.apps.svc:8080",
   "roles": [] }]
```

| Key | |
|---|---|
| `id` | `[a-z0-9-]`, ≤32 — used in the paths below |
| `title`, `icon` | sidebar entry |
| `element` | custom-element tag the bundle defines |
| `url` | the plugin back end, reached from the dashboard server only |
| `roles` | who sees and may call it; empty = any signed-in user |

Invalid entries are skipped with a log line.

**What the plugin back end serves**

- `GET /ui/plugin.js` — an ES module that defines `element`.
- Its API, at any other path.

**Paths**

- `/plugins/<id>` and any subpath — dashboard page hosting the element.
- `/plugin-api/<id>/<path>` → `<url>/<path>`. The bundle is loaded from
  `/plugin-api/<id>/ui/plugin.js`.

**Proxy behaviour.** Adds `Authorization: Bearer <access token>` (refreshed
before expiry; validate it with your IdP), `X-Forwarded-Prefix:
/plugin-api/<id>`, `X-Forwarded-Host/Proto/For`. Passes method, query, body
(≤10 MB) and `accept`, `accept-language`, `content-type`, `cache-control`,
`if-*`, `range`, `x-request-id`. Never forwards dashboard cookies and drops
`Set-Cookie` from responses. Responses stream (SSE works); the wait for
response headers is capped at 30 s. A `Location` on the plugin is rewritten
under the proxy prefix. Mutating requests must come from the dashboard's
own origin. No WebSockets.

Errors from the proxy itself are JSON: `401 {"error":"session_expired"}`
(no session or no usable token), `403 forbidden`, `404 unknown_plugin`,
`400 bad_path` (`.`/`..` segments), `413 body_too_large`,
`502 plugin_unreachable`, `504 plugin_timeout`. Plugin responses, including
its own 401s, pass through unchanged.

**`element.context`** is assigned a new object whenever something changes
(navigation, theme, …) — implement it as a setter:

```ts
{
  user: { sub, name, email },
  roles: string[],
  namespaces: 'all' | string[],   // namespaces this user may access
  cluster: string,
  theme: 'light' | 'dark',
  base: '/plugin-api/<id>',       // prefix for API calls and assets
  route: '/plugins/<id>',         // page root
  path: string,                   // subpath after route, '' at the root
  navigate(path, { replace? }),   // move within the plugin (keeps history)
  reauth()                        // sign in again and come back here
}
```

Plain `<a href="/plugins/<id>/…">` links work too. On a 401 from the
proxy or your back end, call `context.reauth()`.

**Styling.** The element renders inside the dashboard's DOM and should
use its CSS custom properties, which are a stable API (defined on `:root`,
switched for the light theme): `--bg`, `--bg-elev`, `--bg-soft`, `--fg`,
`--fg-soft`, `--muted`, `--rule`, `--accent`, `--accent-d`, `--invert-bg`,
`--invert-fg`, `--code-bg`, `--code-fg`, `--font-sans`, `--font-display`,
`--font-mono`.

**Trust.** Plugin code runs in the dashboard's origin and receives users'
access tokens. Only list plugins you control.

## Local dev

1. Register an OIDC client with redirect URI
   `http://localhost:5173/auth/callback/oidc`.
2. Copy `.env.example` → `.env` and fill in `AUTH_OIDC_*` and
   `AUTH_SECRET` (`openssl rand -hex 32`).
3. `npm install && npm run dev`, open `http://localhost:5173`.

The dev server uses your local kubeconfig.

```
npm run check   # svelte-check + tsc
npm test        # vitest
npm run build   # production build (node build / node start.js)
```

## Stack

SvelteKit 2 + Svelte 5 + TypeScript, Auth.js (`@auth/sveltekit`),
`@kubernetes/client-node`, adapter-node. `start.js` wraps the built
server to add the WebSocket bridges for pod and cloud shells.
