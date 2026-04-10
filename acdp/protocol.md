# ACDP — Agent Coordination Protocol for Development

**Version:** 1.0.0
**Status:** Active

## Overview

ACDP is a lightweight, file-based coordination protocol for multiple AI agents (and humans) collaborating on the same codebase. All state lives inside the repository. There is no central server.

## Core Principles

1. **Git is the source of truth** — all coordination state is committed to the repo.
2. **Declare before you act** — agents must declare intent before modifying any resource.
3. **Locks prevent conflicts** — only one agent may hold a write lock on a resource at a time.
4. **Events are append-only** — the event log is a permanent, ordered record of all actions.
5. **Governance is explicit** — rules for overrides, escalation, and agent management are codified.

---

## 1. Agent Registration

Before an agent can participate, it must be registered.

### Process

1. The agent submits a registration request by appending an entry to `agents.registry.json`.
2. A maintainer (defined in `governance.json`) reviews and approves the registration.
3. Upon approval, the agent is added to `agents.md` with status `idle`.
4. A `register` message is appended to `events.log`.

### Required Fields

| Field        | Type   | Description                           |
|--------------|--------|---------------------------------------|
| `id`         | string | Unique agent identifier (kebab-case)  |
| `role`       | string | One of: `developer`, `reviewer`, `ops`, `architect` |
| `public_key` | string | Agent's public key for identity verification |
| `permissions`| array  | List of allowed actions                |

---

## 2. Intent Declaration

Before working on any task, an agent MUST declare intent.

### Process

1. Update `agents.md` with the current task description and target branch.
2. Set agent status to `working`.
3. Append an `intent` message to `events.log`.

### Rules

- An agent may only declare intent on one task at a time.
- Intent does NOT grant exclusive access. A lock is required for that.
- If two agents declare intent on overlapping resources, the first to acquire a lock wins.

---

## 3. Lock Acquisition and Release

Locks grant exclusive write access to a resource (file, module, or directory).

### Acquiring a Lock

1. Check `locks.json` — if the resource is already locked by another agent, the request is denied.
2. If the resource is free, add an entry to `locks.json` with:
   - `resource`: path or module name
   - `agent_id`: requesting agent
   - `scope`: `file` or `directory` (see Lock Hierarchy below)
   - `acquired_at`: ISO 8601 timestamp
   - `expires_at`: ISO 8601 timestamp (default TTL: 30 minutes)
   - `reason`: brief description of why the lock is needed
3. Append a `lock` message to `events.log`.
4. Commit the changes.

### Releasing a Lock

1. Remove the lock entry from `locks.json`.
2. Append a `release` message to `events.log`.
3. Commit the changes.

### Rules

- Locks have a TTL (time-to-live). Expired locks are considered released.
- An agent MUST release its lock before declaring a new intent on a different resource.
- A maintainer may force-release a lock (see Governance).
- An agent may renew its own lock before expiration by updating `expires_at`.

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

---

## 5. Conflict Handling

### Prevention

- Always acquire a lock before modifying shared resources.
- Declare intent early to signal other agents.
- Work on feature branches, not directly on `main`.

### Detection

- Before merging, check `locks.json` for active locks on affected files.
- If a merge conflict occurs, append a `block` message to `events.log`.

### Resolution

1. The agent with the active lock has priority.
2. If both agents have locks on different files within the same module, they must coordinate via `events.log` using `request` and `ack` messages.
3. If resolution fails, escalate to a maintainer (defined in `governance.json`).
4. The maintainer may force-release locks and assign resolution priority.
5. Once resolved, append a `resolve` message to `events.log`.

---

## 6. Branch Convention

| Branch Pattern            | Purpose                   |
|---------------------------|---------------------------|
| `main`                    | Stable, protected         |
| `agent/<agent-id>/<task>` | Agent working branch      |
| `review/<agent-id>/<task>`| Ready for review          |

---

## 7. Commit Convention

Agents must use conventional commits with an agent tag:

```
<type>(<scope>): <description> [agent:<id>]
```

Example:

```
feat(auth): add JWT refresh endpoint [agent:agent-alpha]
```

---

## 8. Agent Communication Protocol

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
| `lock`     | Agent acquires exclusive access to a resource    | `resource`, `reason`, `ttl_minutes`        |
| `release`  | Agent releases a previously held lock            | `resource`                                 |
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
{"type":"lock","agent":"agent-alpha","timestamp":"2026-04-10T00:15:00-03:00","data":{"resource":"src/frontend/pages/","reason":"Building dashboard views","ttl_minutes":30}}
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

### Design Constraints

- Messages are **minimal** — include only what is necessary for coordination.
- Messages are **machine-readable** — valid JSON, parseable by any agent.
- Messages are **immutable** — once appended, never modified or deleted.
- The full schema is defined in `messages.schema.json`.
