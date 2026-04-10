# ACDP — Agent Coordination Protocol for Development

**Version:** 1.1.0
**Status:** Active

## Overview

ACDP is a lightweight, file-based coordination protocol for multiple AI agents (and humans) collaborating on the same codebase. All state lives inside the repository. There is no central server.

## Core Principles

1. **Git is the source of truth** — all coordination state is committed to the repo.
2. **Declare before you act** — agents must declare intent before modifying any resource.
3. **Locks prevent conflicts** — only one agent may hold a write lock on a resource at a time.
4. **Events are append-only** — the event log is a permanent, ordered record of all actions.
5. **Governance is explicit** — rules for overrides, escalation, and agent management are codified.
6. **Pull before push** — always pull latest state before modifying any ACDP file.

---

## 1. Agent Registration

Before an agent can participate, it must be registered and approved.

### Process

1. The agent adds an entry to `agents.registry.json` with `status: "pending"`.
2. The agent appends a `register` message to `events.log`.
3. A maintainer (defined in `governance.json`) reviews the entry.
4. The maintainer sets `status` to `"approved"` or `"rejected"` in `agents.registry.json`.
5. If approved, the agent is added to `agents.md` with status `idle`.
6. The maintainer appends a `notify` message to `events.log` confirming the decision.

### Approval Rules

- Registration requires approval from a maintainer (see `governance.json`).
- Roles listed in `governance.json` → `auto_approve_roles` skip manual approval.
- The maximum number of active agents is defined in `governance.json` → `max_active_agents`. If the limit is reached, new registrations are rejected until an agent is deregistered.
- An agent with `status: "pending"` MUST NOT declare intent, acquire locks, or modify code.
- An agent with `status: "rejected"` is ignored by the system.

### Required Fields (agents.registry.json)

| Field           | Type   | Description                              |
|-----------------|--------|------------------------------------------|
| `id`            | string | Unique agent identifier (kebab-case)     |
| `role`          | string | One of: `developer`, `reviewer`, `ops`, `architect` |
| `public_key`    | string | Agent's public key for identity verification |
| `permissions`   | array  | List of allowed actions                  |
| `status`        | string | One of: `pending`, `approved`, `rejected` |
| `registered_at` | string | ISO 8601 timestamp                       |
| `approved_by`   | string | ID of the maintainer who approved (null if pending) |

---

## 2. Intent Declaration

Before working on any task, an approved agent MUST declare intent.

### Process

1. Update `agents.md` with the current task description and target branch.
2. Set agent status to `working`.
3. Append an `intent` message to `events.log`.

### Rules

- An agent may only declare intent on one task at a time.
- Intent does NOT grant exclusive access. A lock is required for that.
- If two agents declare intent on overlapping resources, the first to acquire a lock wins.
- Only agents with `status: "approved"` in `agents.registry.json` may declare intent.

---

## 3. Lock Acquisition and Release

Locks grant exclusive write access to a resource (file, module, or directory).

### Acquiring a Lock

1. **Pull latest** — before checking lock state, pull the latest version of `locks.json`.
2. Check `locks.json` — if the resource is already locked by another agent, the request is denied.
3. Verify the agent has not exceeded `max_locks_per_agent` (defined in `governance.json` → `lock_defaults`).
4. If the resource is free, add an entry to `locks.json` with:
   - `resource`: path or module name
   - `agent_id`: requesting agent
   - `scope`: `file` or `directory` (see Lock Hierarchy below)
   - `acquired_at`: ISO 8601 timestamp
   - `expires_at`: ISO 8601 timestamp (default TTL from `governance.json` → `lock_defaults.ttl_minutes`)
   - `reason`: brief description of why the lock is needed
5. Append a `lock` message to `events.log`.
6. Commit and push the changes.

### Releasing a Lock

1. Remove the lock entry from `locks.json`.
2. Append a `release` message to `events.log`.
3. Commit and push the changes.

### Lock Expiration

- Locks have a TTL (time-to-live). Expired locks are considered released.
- The maximum TTL is defined in `governance.json` → `lock_defaults.max_ttl_minutes`.
- **Any agent** that detects an expired lock while reading `locks.json` MAY remove it and append a `release` message with `"expired": true` in the data field. This does not require being the lock owner.
- An agent may renew its own lock before expiration by updating `expires_at` in `locks.json` and appending a `lock` message with `"renewal": true` in the data field.

### Lock Hierarchy

Locks have a `scope` that determines their granularity:

| Scope       | Behavior                                              |
|-------------|-------------------------------------------------------|
| `file`      | Locks ONLY the specified file                         |
| `directory` | Locks ALL files within the specified directory (recursive) |

Hierarchy rules:

- A `file` lock CANNOT be acquired if a `directory` lock exists that contains that file's path.
- A `directory` lock CANNOT be acquired if any `file` lock exists within that directory.
- Two `file` locks on different files within the same directory CAN coexist.
- If `scope` is omitted, it defaults to `file` for paths with extensions, `directory` for paths ending in `/`.

### Wait Queue

If a lock is held by another agent:

1. The requesting agent sets its status to `waiting` in `agents.md`.
2. A `wait` message is appended to `events.log`.
3. The agent polls `locks.json` until the resource is free.

---

## 4. Event Logging

All significant actions are recorded in `events.log` as structured JSON messages (one per line).

### Format

Each line in `events.log` is a valid JSON object:

```json
{"type":"<message_type>","agent":"<agent_id>","timestamp":"<ISO-8601>","data":{}}
```

### Rules

- Events are append-only. Never delete or modify past entries.
- Each event MUST be a single JSON object on its own line (JSONL format).
- Each event MUST include `type`, `agent`, and `timestamp`.
- The `data` field contains type-specific payload.
- See section 8 (Agent Communication Protocol) for the full message type catalog.

### Concurrent Append Resolution

If two agents push changes to `events.log` simultaneously and a merge conflict occurs:

1. **Both appends are valid.** Since events.log is append-only, both new lines should be kept.
2. The agent whose push was rejected MUST pull, resolve the conflict by keeping ALL lines (ordering by timestamp), and push again.
3. This is the ONLY file where merge conflicts are resolved by accepting all changes.

---

## 5. Conflict Handling

### Prevention

- Always acquire a lock before modifying shared resources.
- Declare intent early to signal other agents.
- Work on feature branches, not directly on `main`.
- **Pull before push** — always pull the latest ACDP state before pushing changes to any ACDP file.

### ACDP File Conflict Resolution

If a merge conflict occurs on an ACDP file (not project code):

| File              | Resolution Strategy                                |
|-------------------|----------------------------------------------------|
| `events.log`      | Keep ALL lines from both sides, order by timestamp |
| `locks.json`      | Conflict on same resource → oldest `acquired_at` wins. Different resources → keep both. |
| `agents.md`       | Keep both agent updates                            |
| `state.md`        | Regenerate from `events.log` + `locks.json` + `agents.md` |

### Project Code Conflicts

- Before merging, check `locks.json` for active locks on affected files.
- If a merge conflict occurs, append a `block` message to `events.log`.

### Resolution

1. The agent with the active lock has priority.
2. If both agents have locks on different files within the same module, they must coordinate via `events.log` using `request` and `ack` messages.
3. If a `request` receives `ack` with `accepted: false`, the requesting agent must: (a) wait and retry, (b) send another `request` with more context, or (c) escalate to a maintainer. Maximum 3 retries before escalation is mandatory.
4. If resolution fails, escalate to a maintainer (defined in `governance.json` → `conflict_resolution.escalation_chain`).
5. The maintainer may force-release locks and assign resolution priority. After a lock override, a cooldown period applies (defined in `governance.json` → `lock_override.cooldown_minutes`).
6. Total resolution time must not exceed `governance.json` → `conflict_resolution.max_resolution_time_minutes`.
7. Once resolved, append a `resolve` message to `events.log`.

---

## 6. Agent Offline Detection

### Detection

An agent is considered offline if it has not appended ANY message to `events.log` for a period greater than **2× the TTL of its longest active lock**.

### Process

1. A maintainer appends a `notify` message with `severity: "warning"` identifying the unresponsive agent.
2. If the agent does not respond within the cooldown period (`governance.json` → `lock_override.cooldown_minutes`), the maintainer may:
   - Force-release all locks held by the offline agent.
   - Set the agent's status to `offline` in `agents.md`.
   - Append a `release` message for each freed lock with `"override": true` in the data field.

### Recovery

When an offline agent comes back:

1. It MUST read the current state before doing anything.
2. If its locks were released, it must re-declare intent and re-acquire locks.
3. It sets its status back to `idle` in `agents.md`.

---

## 7. State File Ownership

### Source of Truth Hierarchy

ACDP maintains several files with overlapping information. In case of conflict, this is the priority order:

| Priority | File                   | Authority                    |
|----------|------------------------|------------------------------|
| 1        | `events.log`           | Immutable record of all actions |
| 2        | `locks.json`           | Current lock state           |
| 3        | `agents.registry.json` | Agent identity and approval  |
| 4        | `agents.md`            | Agent operational status     |
| 5        | `state.md`             | Human-readable summary (DERIVED) |

### state.md

`state.md` is a **derived file** — a human-readable summary for convenience. It is NOT authoritative.

- Each agent SHOULD update `state.md` when completing a cycle (intent → lock → work → release → complete).
- If `state.md` conflicts with `events.log`, `locks.json`, or `agents.md`, the other files take priority.
- `state.md` can always be regenerated from the authoritative files.

### agents.md vs agents.registry.json

These files serve different purposes and MUST NOT contradict each other:

| Field   | Authoritative Source     |
|---------|--------------------------|
| `id`    | `agents.registry.json`   |
| `role`  | `agents.registry.json`   |
| `status`| `agents.md` (operational) / `agents.registry.json` (approval) |
| `task`  | `agents.md`              |
| `branch`| `agents.md`              |
| `permissions` | `agents.registry.json` |
| `public_key`  | `agents.registry.json` |

---

## 8. Branch Convention

| Branch Pattern            | Purpose                   |
|---------------------------|---------------------------|
| `main`                    | Stable, protected         |
| `agent/<agent-id>/<task>` | Agent working branch      |
| `review/<agent-id>/<task>`| Ready for review          |

---

## 9. Commit Convention

Agents must use conventional commits with an agent tag:

```
<type>(<scope>): <description> [agent:<id>]
```

Example:

```
feat(auth): add JWT refresh endpoint [agent:agent-alpha]
```

---

## 10. Agent Communication Protocol

All coordination between agents happens through structured JSON messages appended to `events.log`.

### Message Structure

Every message MUST include these fields:

| Field       | Type   | Required | Description                        |
|-------------|--------|----------|------------------------------------|
| `type`      | string | yes      | One of the supported message types |
| `agent`     | string | yes      | ID of the agent sending the message |
| `timestamp` | string | yes      | ISO 8601 timestamp                 |
| `data`      | object | no       | Type-specific payload              |

### Supported Message Types

| Type       | Purpose                                          | Key `data` fields                          |
|------------|--------------------------------------------------|--------------------------------------------|
| `register` | Agent announces its presence                     | `role`, `public_key`                       |
| `intent`   | Agent declares what it will work on              | `task`, `branch`, `resources`              |
| `lock`     | Agent acquires exclusive access to a resource    | `resource`, `scope`, `reason`, `ttl_minutes` |
| `release`  | Agent releases a previously held lock            | `resource`, `expired`, `override`          |
| `update`   | Agent reports progress on current task           | `task`, `progress`, `details`              |
| `complete` | Agent declares a task finished                   | `task`, `branch`, `summary`                |
| `wait`     | Agent signals it is blocked waiting for a lock   | `resource`, `held_by`                      |
| `block`    | Agent reports a blocking issue (conflict, error) | `reason`, `affected_resources`             |
| `resolve`  | A blocking issue has been resolved               | `reference`, `resolution`                  |
| `notify`   | Agent sends an informational broadcast           | `message`, `severity`                      |
| `request`  | Agent asks another agent to take an action       | `to`, `action`, `reason`                   |
| `ack`      | Agent acknowledges a request or notification     | `reference`, `accepted`                    |

### Message Examples

**Register:**
```json
{"type":"register","agent":"agent-alpha","timestamp":"2026-04-09T22:00:00-03:00","data":{"role":"developer","public_key":"ssh-ed25519 AAAAC3..."}}
```

**Intent:**
```json
{"type":"intent","agent":"agent-alpha","timestamp":"2026-04-09T23:00:00-03:00","data":{"task":"Implement user dashboard","branch":"agent/agent-alpha/user-dashboard","resources":["src/frontend/pages/","src/api/routes/auth.ts"]}}
```

**Lock:**
```json
{"type":"lock","agent":"agent-alpha","timestamp":"2026-04-10T00:15:00-03:00","data":{"resource":"src/frontend/pages/","scope":"directory","reason":"Building dashboard views","ttl_minutes":30}}
```

**Release (expired):**
```json
{"type":"release","agent":"agent-beta","timestamp":"2026-04-10T01:00:00-03:00","data":{"resource":"src/frontend/pages/","expired":true}}
```

**Wait:**
```json
{"type":"wait","agent":"agent-beta","timestamp":"2026-04-10T00:22:00-03:00","data":{"resource":"src/api/routes/","held_by":"agent-alpha"}}
```

**Request:**
```json
{"type":"request","agent":"agent-beta","timestamp":"2026-04-10T00:25:00-03:00","data":{"to":"agent-alpha","action":"release lock on src/api/routes/","reason":"Need to implement user profile endpoints"}}
```

**Ack:**
```json
{"type":"ack","agent":"agent-alpha","timestamp":"2026-04-10T00:26:00-03:00","data":{"reference":"agent-beta:request:2026-04-10T00:25:00-03:00","accepted":true}}
```

### Sequencing Rules

1. `register` MUST be the first message from any agent.
2. `intent` MUST precede `lock` — an agent cannot lock without declared intent.
3. `lock` MUST precede any code modification on the locked resource.
4. `release` MUST follow task completion or before declaring a new intent.
5. `ack` SHOULD reference the original message using `agent:type:timestamp` format.
6. `block` and `resolve` always come in pairs — every block must eventually be resolved.

### Request/Ack Flow

When an agent sends a `request`:

1. The target agent SHOULD respond with `ack` within a reasonable time.
2. If `accepted: true` — the target agent commits to the requested action.
3. If `accepted: false` — the requesting agent may:
   - Wait and retry (send another `request`).
   - Provide additional context in a new `request`.
   - Escalate to a maintainer after **3 failed attempts**.
4. If no `ack` is received after 2× the target agent's lock TTL, the request is considered ignored and the requesting agent may escalate directly.

### Design Constraints

- Messages are **minimal** — include only what is necessary for coordination.
- Messages are **machine-readable** — valid JSON, parseable by any agent.
- Messages are **immutable** — once appended, never modified or deleted.
- The full schema is defined in `messages.schema.json`.
