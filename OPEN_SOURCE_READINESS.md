# Open-Source Readiness Plan — AI-Dashboard

Research: 3 agents, 3 disjoint source sets (community/legal, discoverability, security/CI hygiene).
Repo audit: current file tree, `.gitignore`, `package.json`, `gh repo view`, and full `git log --all`
history scan for leaked secrets/credentials.

## Current state (verified against this repo, not assumed)

- GitHub repo `LinuxDevil/AI-Dashboard` is **private**, empty description, **no topics**.
- **No** `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, no `.github/` at all
  (no CI workflow, no issue/PR templates).
- `package.json`: `"name": "claude-dashboard"` (doesn't match the GitHub repo name `AI-Dashboard`),
  and `"private": true` (blocks `npm publish`; fine to leave true if this is app-only and never
  published as a package — flagged as a decision, not auto-changed).
- **Broken README images once public.** Commit `a8b169e` ("untrack gitignored dirs") removed
  `docs/screenshots/*.png` from git tracking and `.gitignore` now excludes `docs/`. The README
  embeds ~10 `docs/screenshots/*.png` images — those links will 404 for anyone who clones the repo.
  This is the single highest-priority fix.
- **Git history checked, clean.** Searched full `git log --all -p` for the credential/secret files
  (`.eng.local.json`, `projects.json`, `bug-ownership.json`, `promptcheck.json`, etc.) and for
  key/token/secret/password-shaped strings — **zero commits, zero matches**. The README's claim that
  secrets are write-only and gitignored holds up against actual history, not just current state.
- Uncommitted local changes present (`README.md`, `index.html`, `package.json`, `src/App.jsx`, etc. +
  untracked `scripts/showcase.mjs`, `src/ticket/tidy.js`, `test/src/tidy.test.js`) — unrelated to this
  plan, left as-is.

## Research findings

### Community & legal essentials
- Add a `LICENSE` — MIT for max adoption/minimal friction, or Apache-2.0 if you want an explicit
  patent grant. ([opensource.guide](https://opensource.guide/legal/),
  [choosealicense.com](https://choosealicense.com/licenses/apache-2.0/))
- Check dependency licenses before finalizing — copyleft deps (GPL/AGPL) can force your hand.
  ([opensource.guide](https://opensource.guide/legal/))
- `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` are recognized by GitHub in root,
  `.github/`, or `docs/` (root is simplest here since `docs/` is gitignored).
  ([GitHub Docs](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file))
- Use the Contributor Covenant rather than writing a code of conduct from scratch.
  ([opensource.guide](https://opensource.guide/code-of-conduct/))
- `SECURITY.md` powers the repo's security-policy tab and gives reporters a private channel.
  ([GitHub Docs](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository))
- Add `.github/ISSUE_TEMPLATE/` + a PR template to standardize what contributors submit.
  ([GitHub Docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates))

### Discoverability & presentation
- Add up to 20 repo topics (lowercase, hyphenated).
  ([GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics))
- Fill in the About section: description + optional website link.
  ([GitHub Docs](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories))
- Set a custom social preview image (1280×640, <1MB) so shared links don't render a generic card.
  ([GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview))
- Add status badges (build, license) via Shields.io — this README currently has none.
  ([shields.io](https://github.com/badges/shields/blob/master/README.md))
- Use GitHub Releases + SemVer once the repo is public, so consumers have a versioned changelog.
  ([semver.org](https://semver.org/))
- Optional: `.github/FUNDING.yml` for a Sponsor button.
  ([GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository))

### Security & CI hygiene
- Scan **full git history**, not just current tree, for secrets before flipping to public. **Done
  above — clean.**
- Enable Dependabot alerts + security updates (Settings → Code security and analysis).
  ([GitHub Docs](https://docs.github.com/code-security/dependabot/dependabot-alerts/about-dependabot-alerts))
- Add a GitHub Actions workflow that runs `npm test` on every PR — none exists today.
  ([GitHub Docs](https://docs.github.com/en/actions/get-started/quickstart))
- Turn on branch protection on `main` requiring the CI check to pass before merge.
  ([GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule))
- Enable private vulnerability reporting so researchers have a disclosure channel from day one.
  ([GitHub Docs](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository))

## Execution plan

**Group A — file changes, doing now (no external side effects, fully reversible in the working tree):**

1. Restore `docs/screenshots/*.png` to git tracking (carve an exception in `.gitignore` for that one
   subfolder) so the README's images actually render for anyone who clones the repo.
2. Add `LICENSE` (MIT, the common default for this kind of tool — swap it if you want Apache-2.0 or
   something else).
3. Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md`.
4. Add `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`,
   `.github/PULL_REQUEST_TEMPLATE.md`.
5. Add `.github/workflows/ci.yml` running `npm test` on push/PR.
6. Fix `package.json`: rename to match the repo (`ai-dashboard`), add `description`, `repository`,
   `license` fields. Leave `"private": true` — flagging, not auto-flipping, since that's a call about
   whether this is ever meant to be `npm install`-able as a package vs. cloned and run.

**Group B — needs your go-ahead before I touch it (GitHub account/repo settings, or irreversible-ish):**

- Flipping the GitHub repo from private → public.
- Setting the repo description, topics, and social preview image via `gh repo edit` (metadata is
  low-risk, but it's a account-visible change — will do on confirmation).
- Enabling Dependabot / branch protection / private vulnerability reporting (repo security settings).
- Committing and pushing any of the above.

Say the word on Group B (or tell me to skip parts of it) and I'll run it; Group A I'm implementing now.
