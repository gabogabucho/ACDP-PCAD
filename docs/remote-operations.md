# ACDP Remote Operations Guide

This short guide helps operators migrate existing repositories and use the hardened remote-first coordination flow safely.

## Migration checklist

1. Create and push `acdp/state` from a clean snapshot of the repository's canonical `acdp/` directory.
2. Verify `origin/acdp/state` contains at least `locks.json`, `events.log`, `agents.md`, `state.md`, and `governance.json`.
3. Run `node acdp/cli.js sync` and `node acdp/cli.js doctor --json` to confirm the branch is visible and protocol files are healthy.
4. Switch operators and agents to the remote-aware commands (`renew`, `status --remote`, `cleanup-remote`, `heartbeat`, `release-remote`) when the branch exists.
5. Keep legacy/local commands available for repositories that still do not expose `origin/acdp/state`.

## Recommended operator workflow

- Use `node acdp/cli.js doctor --json` before sessions to confirm remote readiness, branch health, and active locks for the current agent.
- Use `node acdp/cli.js heartbeat "optional message"` during long-running work so other operators can see liveness on the coordination branch.
- Use `node acdp/cli.js renew <resource|lock-id> [ttlMinutes]` before lock expiry. In remote-first mode this keeps the same `lock_id` and refreshes `base_coord_rev` from the latest coordination head.
- Use `node acdp/cli.js cleanup-remote` for expired-lock cleanup after reconnects or when supervising multiple agents.

## Safety notes

- Never force-push `acdp/state`.
- Treat a missing or expired remote lock as lost ownership, even if a local checkout still remembers it.
- `cleanup-remote` is intentionally conservative: it re-fetches, revalidates expiration on the latest base, and only then publishes cleanup events.
- `doctor` warnings about stale local ACDP files or malformed protocol files should be resolved before mutating coordination state.
