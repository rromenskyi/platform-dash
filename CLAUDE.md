# platform-dash — agent context

SvelteKit operator dashboard for the k3s platform. Authoritative
architecture in `README.md` + per-route `+page.svelte` / `+server.ts`
files. Operator-specific notes (prod host, handoff + notify tooling)
live in the untracked `CLAUDE.local.md`.

## Hard guardrails

- **No blocking awaits in `+layout.server.ts`.** SWR +
  `Promise.race` timeouts only.
- **Stay in repo.** Cluster changes (RBAC, namespaces, ingresses)
  belong to the platform repo — hand them off, never a direct
  `kubectl apply` from this session.
- **All cluster mutations through dashboard's k8s API client** —
  no shelling to kubectl in handlers; use `@kubernetes/client-node`.

## Build / test

```
npm run dev    # local dev
npm run build  # prod
npm run check  # svelte-check + tsc
npm test       # vitest
```
