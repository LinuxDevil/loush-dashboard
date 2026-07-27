# Contributing

## Running it locally

```
npm install
npm run dev      # server (:5178) + Vite (:5177) with --watch
```

Nothing needs configuring to start most sections. JIRA and GitHub credentials are only needed for
**Delivery** — see `projects.example.json` and `README.md` → Setup for how those are wired.

## Running tests

```
npm test         # node --test — pure logic, no network
```

`node --test` discovers recursively, and treats **any** `.js`/`.mjs` file under `test/` as a test
file — put helpers elsewhere. `test/` mirrors the source tree (`test/lib/`, `test/server/`,
`test/src/`); put new tests in the matching directory. It exits `0` when it discovers nothing at
all, so after adding a test confirm the runner actually picked it up (check the "N tests ran"
count), not just that the command succeeded.

## Code style and invariants

There's no linter gate yet, so these are enforced by review, not tooling. Read `README.md` →
Development before touching `server/` or `lib/`; the short version:

- **`safe()` + `backup()` in `server/index.mjs` are the path jail and the timestamped backup on
  every write.** Any new config-writing endpoint must go through them. Don't add a write path that
  skips them.
- **No endpoint takes a filesystem path from the client for a config write.** Paths are fixed
  constants, not request input.
- **Secret values never appear in a response body.** If you add a credential, put it in
  `server/setup.mjs` and keep it write-only — endpoints report `set: true|false`, never the value.
- **Never derive a path from `import.meta.url`.** Import it from `lib/paths.mjs` instead. Every
  path this app resolves on disk is read behind a `try/catch` or a default, so a wrong one doesn't
  throw — it silently returns a plausible-looking wrong answer (a shifted write jail, a permanently
  false `.gitignore` warning, three modules disagreeing about where `projects.json` lives).
- **A file's directory tells you what it is:** `server/` opens listeners, `lib/` is pure and
  tested, `src/sections/` is routable, `src/ui/` is reusable presentation. Keep new code in the
  layer that matches what it does.
- **`null` is never rendered as `0`.** If a value is unmeasured or the sample is too small, return
  `null`/`—`, not a fabricated zero — this is a project-wide honesty rule (see README → Honesty
  rules).
- **No raw hex colors in `src/`.** Every color resolves through the token block at the top of
  `src/styles.css`; a hardcoded hex breaks the light theme.
- Tests should cover the arithmetic a user reads, not just payload shapes — see
  `test/lib/eng-config.test.js` or `test/lib/harness-health.test.mjs` for the pattern.

## Submitting a PR

1. Branch off `main`.
2. Keep the change scoped — this repo has a documented history of scope creep (see README →
   "What was removed, and why"); prefer a small, reviewable diff.
3. Run `npm test` and make sure the suite is green before opening the PR.
4. Describe *why*, not just *what*, in the PR description — especially for anything touching the
   invariants above.
5. Don't commit `projects.json`, `.eng.local.json`, or anything else that's gitignored — those are
   per-machine config/secrets, not app defaults.
