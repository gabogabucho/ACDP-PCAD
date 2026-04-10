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
4. A `REGISTERED` event is appended to `events.log`.

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
3. Append an `INTENT_DECLARED` event to `events.log`.

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
   - `acquired_at`: ISO 8601 timestamp
   - `expires_at`: ISO 8601 timestamp (default TTL: 30 minutes)
   - `reason`: brief description of why the lock is needed
3. Append a `LOCK_ACQUIRED` event to `events.log`.
4. Commit the changes.

### Releasing a Lock

1. Remove the lock entry from `locks.json`.
2. Append a `LOCK_RELEASED` event to `events.log`.
3. Commit the changes.

### Rules

- Locks have a TTL (time-to-live). Expired locks are considered released.
- An agent MUST release its lock before declaring a new intent on a different resource.
- A maintainer may force-release a lock (see Governance).
- An agent may renew its own lock before expiration by updating `expires_at`.

### Wait Queue

If a lock is held by another agent:

1. The requesting agent sets its status to `waiting` in `agents.md`.
2. An `AGENT_WAITING` event is appended to `events.log`.
3. The agent polls `locks.json` until the resource is free.

---

## 4. Event Logging

All significant actions are recorded in `events.log`.

### Format

```
[ISO-8601 timestamp] [EVENT_TYPE] agent:<agent_id> — <description>
```

### Event Types

| Event             | Trigger                                    |
|-------------------|--------------------------------------------|
| `REGISTERED`      | Agent completes registration               |
| `INTENT_DECLARED` | Agent declares work intent                 |
| `LOCK_ACQUIRED`   | Agent acquires a resource lock             |
| `LOCK_RELEASED`   | Agent releases a resource lock             |
| `LOCK_EXPIRED`    | A lock's TTL has elapsed                   |
| `LOCK_OVERRIDE`   | A maintainer force-releases a lock         |
| `AGENT_WAITING`   | Agent is blocked waiting for a lock        |
| `TASK_COMPLETED`  | Agent finishes a declared task             |
| `CONFLICT`        | A merge conflict or coordination issue     |
| `AGENT_OFFLINE`   | Agent goes offline or becomes unresponsive |

### Rules

- Events are append-only. Never delete or modify past entries.
- Each event must have a timestamp, event type, agent id, and description.

---

## 5. Conflict Handling

### Prevention

- Always acquire a lock before modifying shared resources.
- Declare intent early to signal other agents.
- Work on feature branches, not directly on `main`.

### Detection

- Before merging, check `locks.json` for active locks on affected files.
- If a merge conflict occurs, append a `CONFLICT` event to `events.log`.

### Resolution

1. The agent with the active lock has priority.
2. If both agents have locks on different files within the same module, they must coordinate via `events.log`.
3. If resolution fails, escalate to a maintainer (defined in `governance.json`).
4. The maintainer may force-release locks and assign resolution priority.

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
