# ACDP — Roadmap

This document captures features that are fully specified in the protocol but deferred to a future CLI release. The protocol rules remain valid; only the CLI tooling is not yet implemented.

---

## v0.3 — Planned Features

### Wait Queue (deferred from v0.2)

When a lock is held by another agent, a requesting agent may join a wait queue:

1. The requesting agent sets its status to `waiting` in `agents.md`.
2. A `wait` message is appended to `events.log`.
3. The agent polls `locks.json` until the resource is free.

**Planned CLI**: `node acdp/cli.js wait <resource>` — appends `wait` event and polls until lock is released.

---

### Agent Approval Flow (deferred from v0.2)

The formal agent registration and maintainer-approval workflow is defined in `acdp/protocol.md` (Section 1). Currently, registration entries must be created and approved by editing `agents.registry.json` and `events.log` manually.

**Planned CLI**:
- `node acdp/cli.js register` — adds entry to `agents.registry.json` with `status: "pending"` and appends a `register` event.
- `node acdp/cli.js approve <agent-id>` — maintainer approves a pending registration.
- `node acdp/cli.js reject <agent-id>` — maintainer rejects a pending registration.

---

### block / resolve Commands (deferred from v0.2)

The `block` and `resolve` message types are defined in the protocol and in `messages.schema.json`. Conflict events can be appended manually to `events.log`. CLI automation is deferred.

**Planned CLI**:
- `node acdp/cli.js block <reason> [--resources <r1,r2>]` — appends a `block` event to signal a blocking conflict.
- `node acdp/cli.js resolve <reference>` — appends a `resolve` event once the conflict is cleared.

---

## v1.0 — Long-Term

### A2A Agent Identity

Formal Agent-to-Agent identity model: cryptographic agent identity, verified public keys, signed events. Enables trustless multi-organization coordination.

### Governance Advanced Rules

Rule engine for automatic escalation, SLA-based lock override triggers, and per-resource authority delegation.

### Wait Queue — Fair Scheduling

Priority-ordered wait queue with fair scheduling and deadlock detection. Agents are notified when their position changes.
