# Kelryvo

Self-hosted Database DevOps and governance, with Oracle as the initial target.

Read [CHECKLIST.md](CHECKLIST.md) for supported capabilities, delivery policy,
known limitations and next steps. It is the shared status source for app and Helm.

Engineering checkout requires Node 22.23.3, npm 10.9.9 and Python 3.11+:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run next
```

`npm run check` runs bounded delivery checks without PostgreSQL, JDK or Chromium.
Full offline coverage is explicit: `npm run check:full`. Broad API/browser/parser
and install acceptance run separately on schedule or manually and do not gate
routine delivery. Exact-image smoke, security and artifact integrity remain required.
See the checklist for source-install commands and the Oracle support boundary.

Code: `apps/`, `packages/`. Checks: `tests/`, `scripts/`, `.github/workflows/`.
Temporary outputs stay in ignored `.cache/`; retain licenses, notices and parser provenance.
