# platform-dash — agent context

SvelteKit operator dashboard at `dash.ipsupport.us`. Repo:
`github.com/rromenskyi/platform-dash`. Authoritative architecture in
`README.md` + per-route `+page.svelte` / `+server.ts` files.

## Hard guardrails

- **No blocking awaits in `+layout.server.ts`.** SWR +
  `Promise.race` timeouts only.
- **Stay in repo.** Cluster changes (RBAC, namespaces, ingresses)
  via `~/agent-inbox/platform/inbox/` handoff. Never direct
  `kubectl apply` from this session.
- **All cluster mutations through dashboard's k8s API client** —
  no shelling to kubectl in handlers; use `@kubernetes/client-node`.

## Build / test

```
npm run dev    # local dev
npm run build  # prod
npm run check  # svelte-check + tsc
```
