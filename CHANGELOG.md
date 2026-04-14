# Changelog

## v0.4.0 — WebSocket Coordination + MCP

### Breaking Changes

- **Coordination now uses a WebSocket server** instead of Git-based `origin/acdp/state`. Lock state lives in the socket server's memory. All agents connect via MCP.
- **Agents self-configure MCP** on join. The `join-project.md` and `init-project.md` prompts instruct agents to read `acdp-socket-server/config.json` and add the MCP server config automatically.

### New Modules

- **`acdp-socket-server/`** — WebSocket coordination server with in-memory lock state, commit approval engine (auto/manual by path), token auth with owner/sub-owner roles, and JSONL audit logging.
- **`acdp-socket-client/`** — Client library with auto-reconnect, exponential backoff, and promise-based commands.
- **`acdp-mcp-server/`** — MCP server exposing 6 tools (`check_locks`, `lock_files`, `release_files`, `request_commit`, `notify_sync`, `list_agents`) plus a coordination-protocol prompt.

### Documentation

- `protocol.md` updated to document WebSocket coordination as the primary mode.
- `join-project.md` and `init-project.md` rewritten with MCP self-configuration instructions.
- `README.md` updated with new architecture, setup guide, and visual overview.

---

## v0.3.0 — Remote-Only Coordination

### Breaking Changes

- **`lock`, `release`, and `cleanup` are now remote-only.** All three commands always publish to `origin/acdp/state`. If that branch does not exist, the command fails with an explicit error. There is no local-only lock path.
- **`lock-remote`, `release-remote`, and `cleanup-remote` have been removed.** These commands no longer exist. Use `lock`, `release`, and `cleanup` directly.

### New Features

- **`default_branch` in `governance.json`.** A required field at the top level of `governance.json`. The CLI reads it to record `base_branch` on every lock entry and event, so all agents know the integration target without asking.
- **`base_branch` on lock entries.** Every lock now includes `base_branch` (from `governance.json → default_branch`) alongside the existing `branch` field (agent working branch).

### Documentation

- `protocol.md` updated to reflect remote-only as the only coordination mode.
- `acdp/prompts/join-project.md` and `init-project.md` updated to use `lock`/`release`/`cleanup` and document `default_branch` setup.
- READMEs, remote operations guide, and simulation notes updated to remove references to deprecated commands.

---

## v0.2.0 — Trustworthy Core

### Breaking Changes

- **TTL default reduced: 30 min → 15 min** (`lock_defaults.ttl_minutes` in `governance.json`). Existing locks created with the old default remain valid until their stored `expires_at`. New locks without an explicit TTL will expire in 15 minutes.
- **`max_ttl_minutes` reduced: 120 min → 60 min**. Locks requested with a TTL above 60 will be capped.
- **`lock-remote` is now remote-first only.** If `origin/acdp/state` does not exist, `lock-remote` throws an explicit error instead of silently falling back to local mode. Use `lock` for local-only coordination.

### New Features

- **`override-release <agent-id>`** — Maintainer-only command. Force-releases all locks held by the specified agent. Requires the caller's `ACDP_AGENT_ID` to be listed in `governance.json` → `maintainers`. Supports `--json`.
- **`subscribe`** — Streams the local `events.log` as raw JSONL to stdout. Polls every 2 seconds. Exit with `SIGINT`. Useful for MCP server wrappers and A2A event consumption.
- **`finish` is now remote-aware.** When `origin/acdp/state` exists, `finish` publishes the DONE state via `publishRemoteMutation` so all remote agents receive the signal. Use `--offline` to force local-only write. Supports `--json`.
- **`--json` flag** on all mutating commands: `lock`, `lock-remote`, `release`, `release-remote`, `finish`, `override-release`.
- **Auto-cleanup before lock-remote.** Expired locks are cleaned from the coordination branch before conflict detection, preventing a crashed agent's expired lock from blocking new acquisitions.
- **Unified release events.** Local `release` events now include `lock_id` and `branch` when available, matching the remote event schema.

### Fixes

- Removed duplicated `locksConflict` and `isWithinDirectory` functions from `cli.js`. Both now resolve exclusively from `lock-manager.js`.

### Documentation

- `VERSION` file at repo root is now the single version source. `protocol.md` and READMEs reference it.
- `docs/roadmap.md` created. Deferred features (wait-queue CLI, block/resolve CLI, agent approval flow CLI) moved there from `protocol.md`.
- `acdp/protocol.md` updated to reflect remote-first as the default coordination mode.

---

## v0.1.0 — Initial release (experimental)

Initial local-first coordination protocol with remote hardening via `origin/acdp/state`.
