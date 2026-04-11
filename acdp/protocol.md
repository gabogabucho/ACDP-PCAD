# ACDP — Agent Coordination Protocol for Development

**Version:** see [VERSION](../VERSION) file — current release: 0.2.0
**Status:** Active

## Overview

ACDP is a lightweight, file-based coordination protocol for multiple AI agents (and humans) collaborating on the same codebase. All state lives inside the repository. There is no central server.

Remote hardening adds an optional remote-first coordination mode over Git. When the repository exposes `origin/acdp/state`, that branch becomes the authoritative shared coordination branch for ACDP state.

## Core Principles

1. **Git is the source of truth** — all coordination state is committed to the repo.
2. **Declare before you act** — agents must declare intent before modifying any resource.
3. **Locks prevent conflicts** — only one agent may hold a write lock on a resource at a time.
4. **Events are append-only** — the event log is a permanent, ordered record of all actions.
5. **Governance is explicit** — rules for overrides, escalation, and agent management are codified.
6. **Pull before push** — always pull latest state before modifying any ACDP file.
7. **Sync before mutate in remote mode** — when `origin/acdp/state` exists, mutations must be based on the latest remote coordination revision.
---

## Coordination Modes

As of v0.2, ACDP is **remote-first**. `lock-remote` and `release-remote` require `origin/acdp/state` to exist and will fail with an explicit error if it does not. Use `--offline` for read-only inspection when the remote is unavailable.

| Mode | When it applies | Source of coordination truth |
|------|------------------|------------------------------|
| Remote-first (default) | `origin/acdp/state` exists | `origin/acdp/state` for all coordination mutations |
| Offline / local | `--offline` flag or legacy local commands | The current branch's `acdp/` files |

### Remote-first mode

- `acdp/state` stores the same coordination artifacts already used by ACDP, including `locks.json`, `events.log`, `agents.md`, and `state.md`.
- Feature work continues on normal working branches such as `agent/<id>/<task>`.
- Agents MAY mirror ACDP files on feature branches for convenience, but `origin/acdp/state` is authoritative when present.
- Tooling MUST report remote coordination availability honestly. It MUST NOT pretend the branch exists when it does not.

### Sync-before-mutate rule

In remote-first mode, an agent MUST fetch and resolve the latest `origin/acdp/state` head before any coordination mutation, including:

- intent declaration tied to a remote lock flow
- lock acquire / renew / release
- cleanup of expired locks
- agent operational status updates
- `state.md` regeneration or publication

Each accepted remote mutation MUST record the remote coordination revision it observed as `base_coord_rev`. Retrying with an old `base_coord_rev` after the remote head changed is invalid.

## Synchronization

ACDP is a distributed protocol. Agents work independently and communicate through shared files in the repository. To stay coordinated, agents MUST pull the latest state at specific checkpoints.

### Mandatory Sync Points

An agent MUST run `git pull` (or equivalent) before:

| Checkpoint                        | Why                                                    |
|-----------------------------------|--------------------------------------------------------|
| Declaring intent                  | To see current locks and other agents' intents         |
| Acquiring a lock                  | To verify the resource is actually free                |
| Starting code modifications       | To work on the latest codebase                         |
| Pushing any commit                | To detect conflicts before they happen                 |
| Reading `events.log` for messages | To see requests, acks, or notifications from others    |

### Recommended Sync Points

An agent SHOULD also pull:

- Periodically during long tasks (every 10–15 minutes)
- After receiving an `ack` with `accepted: false`
- Before sending a `complete` message

### Remote-first interpretation

When `origin/acdp/state` exists, the required synchronization target for coordination mutations is the coordination branch head itself, not only the current feature branch. In practice, an agent MUST fetch/read `origin/acdp/state`, derive the current coordination revision, and then mutate from that revision.

An agent that has been offline or working from a stale cached coordination view MAY continue local code work at its own risk, but it MUST NOT assume a later coordination mutation will be accepted without a fresh sync.

### Rule

An agent that acts on stale state is responsible for any conflicts that result. "I didn't pull" is not a valid excuse under the protocol.

---

## 0. Project Initialization

Before any agent can participate, the project must have its coordination structure defined. This is typically done by the project owner or the first agent.

### Required Files

The following ACDP files MUST exist before agents can register:

| File                   | Purpose                                       | Created By     |
|------------------------|-----------------------------------------------|----------------|
| `acdp/protocol.md`    | This document — the rules of the game         | Project owner  |
| `acdp/architecture.md`| Module structure, boundaries, and ownership   | Project owner or first agent |
| `acdp/governance.json` | Authority rules, lock defaults, escalation   | Project owner  |
| `acdp/agents.registry.json` | Agent identity registry (starts empty) | Project owner  |
| `acdp/agents.md`      | Agent operational status (starts empty)        | Project owner  |
| `acdp/locks.json`     | Active locks (starts as `{"locks": []}`)       | Project owner  |
| `acdp/events.log`     | Event log (starts empty)                       | Project owner  |
| `acdp/state.md`       | Human-readable state summary                   | Project owner  |
| `acdp/messages.schema.json` | JSON Schema for message validation       | Project owner  |

### architecture.md Requirements

`architecture.md` is the **map of the project**. Without it, agents cannot perform resource assessment and work blind. It MUST include:

1. **Module list** — what areas exist in the project (e.g., `src/frontend/`, `src/api/`, `src/db/`)
2. **Ownership** — who is responsible for each module (can be an agent, a human, or unassigned)
3. **Restricted areas** — modules that require special approval to modify (e.g., `acdp/`, config files, deploy scripts)
4. **Dependency flow** — how modules relate to each other (e.g., `frontend → api → db`)

For new projects, `architecture.md` describes the **planned structure**. For existing projects, it documents the **current structure**.

### Initialization Sequence

1. The project owner creates the `/acdp/` directory and all required files.
2. The owner defines `architecture.md` with the module structure.
3. The owner configures `governance.json` with authority rules.
4. The owner commits and pushes. The project is now ACDP-ready.
5. Agents may begin registering (see section 1).

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

Before working on any task, an approved agent MUST assess available resources and then declare intent.

### Resource Assessment

Before declaring intent, the agent MUST evaluate the current state to choose an area of work that minimizes conflicts:

1. **Sync** — pull the latest state (see Synchronization).
2. Read `locks.json` — identify which resources are currently locked.
3. Read `agents.md` — see what other agents are working on.
4. Read recent `intent` messages in `events.log` — detect resources that are claimed but not yet locked.
5. Read `architecture.md` — understand module boundaries and restricted areas.

Based on this assessment, the agent builds a list of **available resources** — areas that are not locked, not claimed by another agent's intent, and not restricted.

If the agent was given a specific task by a human, it should verify the required resources are available. If they are not, the agent SHOULD report back to the human with:
- Which resources are needed but unavailable
- Who holds them and for how long (from `locks.json` TTL)
- Alternative areas where work could begin immediately

This allows the human to decide whether to wait, reassign the task, or request a lock release.

### Declaring Intent

Once the agent has identified available resources:

1. Check `events.log` for any pending `request` or `notify` messages directed at you.
2. Update `agents.md` with the current task description and target branch.
3. Set agent status to `working`.
4. Append an `intent` message to `events.log`, listing the target resources.

### Rules

- An agent may only declare intent on one task at a time.
- Intent does NOT grant exclusive access. A lock is required for that.
- If two agents declare intent on overlapping resources, the first to acquire a lock wins.
- Only agents with `status: "approved"` in `agents.registry.json` may declare intent.
- An agent SHOULD prefer resources that are not listed in any other agent's active intent.

---

## 3. Lock Acquisition and Release

Locks grant exclusive write access to a resource (file, module, or directory).

### Acquiring a Lock

1. **Sync** — pull the latest state (see Synchronization).
2. Check `locks.json` — if the resource is already locked by another agent, the request is denied.
3. Verify the agent has not exceeded `max_locks_per_agent` (defined in `governance.json` → `lock_defaults`).
4. If the resource is free, add an entry to `locks.json` with:
    - `resource`: path or module name
    - `agent_id`: requesting agent
    - `scope`: `file` or `directory` (see Lock Hierarchy below)
    - `acquired_at`: ISO 8601 timestamp
    - `expires_at`: ISO 8601 timestamp (default TTL from `governance.json` → `lock_defaults.ttl_minutes`)
    - `reason`: brief description of why the lock is needed
    - `lock_id`: unique identifier for the lock lifecycle (required in remote-first mode; additive elsewhere)
    - `base_coord_rev`: remote coordination revision observed before the mutation (required in remote-first mode)
    - `branch`: agent working branch when relevant
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
- In remote-first mode, a lock is valid only if it still exists in the latest accepted `origin/acdp/state` and has not expired there. A locally remembered lock is not sufficient proof of ownership.
- Renewal in remote-first mode MUST keep the same `lock_id` and MUST use a freshly synchronized `base_coord_rev`.
- Tooling SHOULD expose an explicit renew operation so agents can renew by resource or `lock_id` without reacquiring.
- If a remotely synchronized read shows the lock missing or expired, the agent MUST treat the lock as lost and reacquire instead of retroactively renewing.

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

CLI-based wait queue is deferred to v0.3. See [docs/roadmap.md](../docs/roadmap.md).

The `wait` message type remains valid — agents may append it manually to signal waiting.

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

In remote-first mode, the losing writer MUST first fetch the new `origin/acdp/state` head, regenerate any `base_coord_rev` metadata against that newer head, and re-evaluate whether the intended mutation is still valid before retrying.

---

## 5. Conflict Handling

### Prevention

- Always acquire a lock before modifying shared resources.
- Declare intent early to signal other agents.
- Work on feature branches, not directly on `main`.
- **Pull before push** — always pull the latest ACDP state before pushing changes to any ACDP file.
- In remote-first mode, never force-push coordination updates and never retry against a stale coordination revision.

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
5. A maintainer may use `node acdp/cli.js override-release <agent-id>` to force-release all locks held by an offline or blocked agent. After a lock override, a cooldown period applies (defined in `governance.json` → `lock_override.cooldown_minutes`).
6. Total resolution time must not exceed `governance.json` → `conflict_resolution.max_resolution_time_minutes`.
7. Once resolved, append a `resolve` message to `events.log`.

> **CLI note**: `block` and `resolve` CLI commands are deferred to v0.3. See [docs/roadmap.md](../docs/roadmap.md). The message types remain valid and agents may append them manually.

### Remote-first retry rules

- If publication of `acdp/state` fails because the remote head changed, the agent MUST fetch, re-read, and recompute from the new head.
- Automatic retry SHOULD be bounded. Three attempts for the same intended mutation is the recommended ceiling.
- If the refreshed state shows the requested resource is now incompatible (for example, another lock won the race), the agent MUST stop blind retries and follow the normal wait/request/escalation rules.

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

In remote-first mode, this means synchronizing `origin/acdp/state` first. If the remote branch no longer contains the previous `lock_id`, or the TTL has elapsed there, the lock is no longer authoritative.

### Operational heartbeats

- Agents MAY append lightweight `update` events as heartbeat/liveness signals during long-running work.
- In remote-first mode, heartbeat updates MUST also follow sync-before-mutate and SHOULD include `base_coord_rev`.
- Heartbeats do not extend lock TTL by themselves; use an explicit renew operation for that.

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

When `origin/acdp/state` exists, this hierarchy applies to the files on that branch for coordination purposes.

### Remote cleanup and operator checks

- Expired-lock cleanup in remote-first mode MUST re-read the latest coordination branch before publication and MUST only remove locks still expired on that refreshed base.
- Cleanup release events remain schema-compatible and SHOULD carry `expired: true`, `lock_id` when known, and remote coordination metadata such as `base_coord_rev`.
- Tooling SHOULD provide a doctor/readiness command that reports whether `origin/acdp/state` exists, whether local coordination files differ from the remote branch, whether protocol files are parseable enough to operate, and which active locks are held by the current agent.
- In remote-first mode, observability SHOULD distinguish between expected feature-branch divergence, a stale mirrored coordination snapshot on the current branch, and local protocol file edits that currently differ from the authoritative remote state.
- If authoritative `locks.json` or `events.log` on `origin/acdp/state` are malformed or unparseable, observability tooling MUST surface that explicitly and MUST fail health instead of silently treating those files as empty.

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
| `acdp/state`              | Authoritative coordination branch when present |
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
| `intent`   | Agent declares what it will work on              | `task`, `branch`, `resources`, `base_coord_rev?` |
| `lock`     | Agent acquires exclusive access to a resource    | `resource`, `scope`, `reason`, `ttl_minutes`, `lock_id?`, `base_coord_rev?`, `branch?` |
| `release`  | Agent releases a previously held lock            | `resource`, `expired`, `override`, `lock_id?`, `base_coord_rev?`, `branch?`          |
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
{"type":"lock","agent":"agent-alpha","timestamp":"2026-04-10T00:15:00-03:00","data":{"resource":"src/frontend/pages/","scope":"directory","reason":"Building dashboard views","ttl_minutes":30,"branch":"agent/agent-alpha/user-dashboard","lock_id":"agent-alpha-lck-01","base_coord_rev":"8d4f2ab9f9b7"}}
```

**Release (expired):**
```json
{"type":"release","agent":"agent-beta","timestamp":"2026-04-10T01:00:00-03:00","data":{"resource":"src/frontend/pages/","expired":true,"lock_id":"agent-alpha-lck-01","base_coord_rev":"8d4f2ab9f9b7"}}
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
