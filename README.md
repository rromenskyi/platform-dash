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
