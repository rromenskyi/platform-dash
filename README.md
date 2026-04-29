# platform-dash

SvelteKit operator console for [platform](https://github.com/rromenskyi/platform).
OIDC login through the platform's [Zitadel](https://github.com/rromenskyi/terraform-minikube-platform) IdP.

## Stack

- **SvelteKit 2** + **Svelte 5** (runes) + **TypeScript**
- **Auth.js** (`@auth/sveltekit`) — OIDC via Zitadel, server-side cookie sessions, automatic refresh
- **adapter-node** — runs as a long-lived Node process behind Traefik in the cluster

## Local dev

1. Create the OIDC Application in Zitadel:
   - Console → your project → Applications → New → **Web** → **OIDC**
   - Auth flow: **Authorization Code** + **Refresh Token** + **PKCE**
   - Redirect URI: `http://localhost:5173/auth/callback/zitadel`
   - Post-logout URI: `http://localhost:5173/`
   - Save the `client_id` (and `client_secret` if you picked Web confidential)
2. Copy `.env.example` → `.env`, fill in `AUTH_ZITADEL_*` and `AUTH_SECRET`
   (`openssl rand -hex 32` for the secret).
3. `npm install && npm run dev`
4. Open `http://localhost:5173`, click **Sign in**, you should land
   on the Zitadel login page and bounce back signed in.

## Production

`npm run build && node build` produces a self-contained Node server.
Containerise + deploy as a `kind: deployment` component in the
platform repo (`config/components/platform-dash.yaml`), expose
via `app.<domain>` route. Redirect URI in Zitadel must match the
public hostname.
