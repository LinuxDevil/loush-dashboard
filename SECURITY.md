# Security Policy

## Reporting a vulnerability

There's no dedicated security email yet. Please **do not open a public issue** for a suspected
vulnerability — instead use GitHub's private reporting flow:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, how to reproduce it, and its impact.

This opens a private advisory visible only to you and the maintainers, so the report doesn't
disclose the issue publicly before a fix ships.

## What's worth flagging

This app runs a **local Express server bound to localhost** (`:5178`) that can write to your real
`~/.claude` config — settings, hooks, MCP config, credentials, and more (see README → Risks &
mitigations for the full write surface and the `safe()`/`backup()` path-jail invariant). That write
access is the main attack surface: anything that lets a remote page, another local process, or a
malicious untrusted artifact reach `localhost:5178` and trigger a write is worth reporting, as is
anything that would let the server write outside its intended path jail.

Untrusted HTML/JSX artifacts render inside a sandboxed iframe with no `allow-same-origin` — a report
showing a path to break out of that sandbox (or otherwise reach the dashboard API from rendered
artifact content) is a high-priority finding.

## Scope

This is a local developer tool, not a hosted service — there's no production deployment to protect
beyond your own machine. Reports about the server accepting connections from anything other than
localhost, path traversal outside the allowed write jail, secret values leaking into a response
body, or sandbox escapes in the artifact viewer are all in scope.
