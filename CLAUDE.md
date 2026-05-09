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

## Pinging the operator

Push a one-liner via the orchestrator's localhost endpoint when a
task lands or you hit a blocker. Bot token stays in orchestrator.

```bash
~/gh/private-agent-project-manager/orchestrator/scripts/pm-notify \
    platform-dash "PR #48 cloudshell ready for RBAC apply"

~/gh/private-agent-project-manager/orchestrator/scripts/pm-notify \
    -s high platform-dash "k8s API client lost auth — dashboard 500s"
```

Severity: `low` / `normal` (default) / `high`. Use `high` only for
prod-visible regressions or operator-blocking decisions.

Cluster mutations still go through `~/agent-inbox/platform/inbox/`
handoff (not `/notify`).
