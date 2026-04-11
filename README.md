# ACDP — Agent Coordination Protocol for Development

🌐 **[Leer en español](README.es.md)**

## Description

ACDP (Agent Coordination Protocol for Development) is an open standard that defines how multiple agents (AIs and humans) can collaborate on the same code repository without generating conflicts, maintaining coherence and traceability in dynamic development environments.

ACDP introduces a coordination layer on top of traditional version control systems, enabling structured parallel work in high-iteration contexts.

---

## Problem

AI-assisted development (vibecoding) introduces new dynamics:

* Multiple agents generate changes simultaneously
* Changes are broad and non-incremental
* Commit history loses value as a source of truth
* Integration conflicts increase
* There is no common coordination protocol between agents

Current systems are designed for incremental human collaboration, not for multi-agent coordination.

---

## Objective

Define a protocol that enables:

* Coordination between agents without a mandatory central authority
* Concurrent work without destructive conflicts
* Structured communication between agents
* Shared state persistence
* Traceability of decisions and actions

---

## Approach

ACDP operates as a logical layer within the repository. It does not replace the version control system — it complements it.

It is based on:

* Shared state inside the repository
* Explicit behavioral rules
* Coordination through structured files
* Distributed consensus among agents

---

## Core Components

### Agent Identity

Each agent registers and operates under a defined identity, verified through a public key in the agent registry.

### Intent Declaration

Before modifying the system, an agent declares its intention — what it will do, which resources it will touch, and on which branch.

### Resource Locks

Concurrent modification of the same resources is prevented through logical locks with automatic expiration (TTL).

### Shared State

The system maintains a human-readable representation of the current project state.

### Event Log

Relevant actions are recorded in a sequential, append-only log.

### Architecture Boundaries

Module ownership, restricted areas, and cross-module coordination rules are explicitly defined.

### Agent Communication

All coordination between agents happens through structured JSON messages appended to `events.log`. The protocol defines 12 message types (`register`, `intent`, `lock`, `release`, `update`, `complete`, `wait`, `block`, `resolve`, `notify`, `request`, `ack`) with a formal schema for validation.

### Governance

Rules are defined about who can participate, how decisions are made, and who can override locks.

---

## Architecture

ACDP is implemented inside the repository through a standard structure:

```
/acdp/
  protocol.md            # Coordination rules
  architecture.md        # Module map and ownership
  state.md               # Current system snapshot
  agents.md              # Active agent roster
  events.log             # JSONL event log ({ type, agent, timestamp, data })
  locks.json             # Canonical lock store ({ "locks": [...] })
  governance.json        # Authority and override rules
  agents.registry.json   # Trusted agent definitions
  messages.schema.json   # JSON Schema for message validation
  cli.js                 # Protocol-safe CLI entrypoint
  lock-manager.js        # TTL-backed lock lifecycle manager
  export-logs.js         # Gzip exporter for events.log snapshots
  log-exports/           # Generated log archives (Git-ignored)
  prompts/
    init-project.md      # Prompt to start a project with ACDP
    join-project.md      # Prompt for an agent to join a project
  examples/
    simulation-php.md    # Full simulation with 3 agents
    simulation-stress-test.md
    pattern-100-percent-ai.md
    pattern-100-percent-ai.es.md
/scripts/
  git-hooks/
    pre-commit           # Versioned protocol guard (manual opt-in)
```

---

## Visual Overview

```
                ┌──────────────────────────────────┐
                │           Repository             │
                │                                  │
                │   Project source code            │
                │   (/src, /api, etc.)             │
                │                                  │
                │   ┌──────────────────────────┐   │
                │   │         /acdp/           │   │
                │   │                          │   │
                │   │  protocol.md             │   │
                │   │  architecture.md         │   │
                │   │  messages.schema.json    │   │
                │   │  cli.js                  │◄─────────┐
                │   │  lock-manager.js         │◄──────┐  │
                │   │  state.md                │◄────┐ │  │
                │   │  agents.md               │◄──┐ │ │  │
                │   │  locks.json              │◄┐ │ │ │  │
                │   │  events.log (JSONL)      │◄┼─┘ │ │  │
                │   │  export-logs.js          │  │   │ │  │
                │   └──────────────────────────┘  │   │ │  │
                │   /scripts/git-hooks/pre-commit│◄──┘ │  │
                └──────────────────────────────────┴────┴──┘
                                                     ▲
        ┌──────────────┐       ┌──────────────┐      │
        │   Agent 01   │       │   Agent 02   │      │
        │ (AI / human) │       │ (AI / human) │      │
        └──────┬───────┘       └──────┬───────┘      │
               │                      │              │
               ├──── read state ──────┼──────────────┤
               ├── declare intent ────┼──────────────┤
               ├─ acquire/renew lock ─┼──────────────┤
               ├──── cleanup/watch ───┼──────────────┤
               ├──── release/complete ┼──────────────┤
               └──── export logs ─────┴──────────────┘
```

---

## Workflow

1. An agent accesses the repository
2. Reads the current state in `/acdp/`
3. Registers as an active agent
4. Declares its intent
5. Checks resource availability
6. Acquires a logical lock
7. Makes changes on its own branch
8. Logs relevant events
9. Releases the lock
10. Updates the shared state

---

## Access Model

ACDP does not manage repository access.

Access is controlled by the version control system.

ACDP defines:

* Which agents are recognized
* How they must behave
* How their actions are validated

Unrecognized agents can be ignored by the system.

---

## Philosophy

* Simplicity over complexity
* Coordination over control
* Shared state over implicit synchronization
* Distributed consensus over central authority
* Observability for humans

---

## 🛠️ ACDP CLI Automation

To avoid token bloat and prevent manual JSON tampering mistakes, ACDP ships with a built-in CLI utility (`acdp/cli.js`).

**Lock operations must go through the CLI.** Do not hand-edit `acdp/locks.json` or append ad-hoc JSON to `acdp/events.log` for normal lock lifecycle operations.

The CLI is backed by `acdp/lock-manager.js`, which enforces a TTL-backed lock lifecycle: lock acquisition, same-agent renewal, expired-lock cleanup, conflict detection across file/directory scopes, and canonical persistence back into `acdp/locks.json`.

Agents can execute protocol-safe operations natively:
- `node acdp/cli.js lock "src/file.js" file "Implementing feature" 30`
- `node acdp/cli.js release "src/file.js" "Feature complete"`
- `node acdp/cli.js status`
- `node acdp/cli.js cleanup` (Removes expired locks and emits schema-compliant `release` events with `data.expired: true`.)
- `node acdp/cli.js batch "refresh-cache" "src/cache/data.json" 5 file` (For short scripted intent → lock → release flows.)
- `node acdp/cli.js finish [--json] [--offline]` (Globally declares the project explicitly finished; remote-aware when `origin/acdp/state` exists.)
- `node acdp/cli.js watch` (Spawns a real-time terminal radar and shows lock TTL context when relevant.)
- `node acdp/cli.js subscribe` (Streams raw JSONL events to stdout; exits on SIGINT. Useful for MCP/A2A integration.)
- `node acdp/cli.js override-release <agent-id> [--json]` (Maintainer-only: force-releases all locks held by the specified agent.)
- `node acdp/export-logs.js` (Exports `events.log` to a gzip archive under `acdp/log-exports/`, which is ignored by Git.)

The CLI keeps protocol artifacts aligned with the documented format:
- `acdp/locks.json` uses the canonical object shape `{ "locks": [...] }`
- `acdp/events.log` entries use `{ type, agent, timestamp, data }` JSONL records compatible with `acdp/messages.schema.json`
- `cleanup`, `batch`, and normal `release` flows emit canonical `release`/`complete` events instead of legacy payload shapes
- `watch` renders the live JSONL stream without changing protocol state, while `export-logs` snapshots it for audit/archive workflows

### Remote-first hardening

ACDP now supports an additive remote-first coordination mode over Git.

- If `origin/acdp/state` exists, treat that branch as the authoritative coordination branch.
- Remote mutations must sync before mutate: fetch/read the latest coordination head first, then publish from that exact revision.
- Remote lock lifecycle metadata now carries `lock_id` and `base_coord_rev`, while preserving the existing JSONL event shape.
- If `origin/acdp/state` does not exist, the CLI falls back to the existing local/legacy behavior.

Useful commands:

- `node acdp/cli.js sync` — fetches and reports the current remote coordination head when available.
- `node acdp/cli.js status --remote` — shows remote coordination availability, head revision, authoritative remote health, expected feature-branch divergence, stale coordination snapshot signals, and local protocol diffs vs the authoritative branch.
- `node acdp/cli.js status --remote --json` — same data in machine-readable form.
- `node acdp/cli.js lock-remote "src/file.js" file "Implement feature" 30` — acquires or renews a lock on `origin/acdp/state`, with bounded retry on remote-head races.
- `node acdp/cli.js release-remote "src/file.js" "Feature complete"` — releases a remote lock and appends compatible lifecycle events on the coordination branch.
- `node acdp/cli.js renew "src/file.js" 45` — explicitly renews an existing lock by resource or `lock_id`; in remote mode it preserves `lock_id` and refreshes `base_coord_rev`.
- `node acdp/cli.js cleanup-remote` — safely removes only locks still expired on the latest remote base and emits compatible `release` events with `expired: true`.
- `node acdp/cli.js heartbeat "still working"` — appends a lightweight schema-compatible liveness `update`, remote-aware when `origin/acdp/state` exists.
- `node acdp/cli.js doctor --json` — reports remote readiness, branch health, protocol file sanity, authoritative remote parse errors, and locks held by the current agent. It exits non-zero when health fails.

Remote observability notes:

- `local_stale` remains in JSON output as a backward-compatible alias for `local_protocol_differs_from_remote`.
- Expected divergence between a feature branch and `acdp/state` is now reported separately from an actually stale coordination snapshot.
- If authoritative `locks.json` or `events.log` on `origin/acdp/state` are malformed, observability commands report that explicitly and health fails instead of silently treating them as empty.

The hardened flow intentionally keeps `locks.json` and `events.log` as the canonical coordination files; the change is *where* they are published and *how* tooling proves freshness.

Operator migration guidance is available in [`docs/remote-operations.md`](docs/remote-operations.md).
Practical remote trial notes and signal interpretation guidance are available in [`docs/remote-simulation-notes.md`](docs/remote-simulation-notes.md).

**Definition of DONE (Exit Clause):**
When the project's `state.md` is marked with `Status: DONE` (enforced natively via `node acdp/cli.js finish`), all participating agents MUST immediately cease operations, abandon internal task-seeking loops, and formally log off. Ongoing automated tasks should be aborted.

---

## 🔒 Versioned Commit Guard

ACDP includes a versioned pre-commit guard at `scripts/git-hooks/pre-commit`.

What it checks:
- commits are blocked when `acdp/locks.json` still contains active locks
- `acdp/locks.json` keeps the canonical `{ "locks": [...] }` shape
- `acdp/events.log` remains valid JSONL and uses `agent/data`, not legacy `agent_id/payload`
- event types stay aligned with `acdp/messages.schema.json`

Suggested installation:

```bash
git config core.hooksPath scripts/git-hooks
```

This hook is **not enabled automatically**. Enable it manually either by pointing `core.hooksPath` at `scripts/git-hooks` or by copying `scripts/git-hooks/pre-commit` into `.git/hooks/pre-commit`. On Unix-like systems, ensure it is executable.

---

## Quick Start: AI Prompts

ACDP includes ready-to-use prompts that you can copy and paste into any AI agent (Claude, GPT, Gemini, etc.).

### Start a new project

Use [`acdp/prompts/init-project.md`](acdp/prompts/init-project.md) — gives the AI instructions to initialize the ACDP structure, register itself as the first agent, define the architecture, and start working.

### Add an agent to an existing project

Use [`acdp/prompts/join-project.md`](acdp/prompts/join-project.md) — gives the AI instructions to read the current state, register, check for active locks, declare intent, and contribute without conflicts.

---

## Simulation

See [`acdp/examples/simulation-php.md`](acdp/examples/simulation-php.md) for a complete walkthrough of 3 agents (2 AIs + 1 human) building a PHP website, including:

* Parallel work without conflicts
* A lock conflict resolved through request/ack/notify messages
* A shared config file managed without merge conflicts
* The complete `events.log` output (23 messages)

For remote-first operator scenarios such as reconnects, stale snapshots, same-resource races, and cleanup under renewal races, see [`docs/remote-simulation-notes.md`](docs/remote-simulation-notes.md).

---

## Project Status

Version: v0.2.0

ACDP is in active development. See [CHANGELOG.md](CHANGELOG.md) for release notes and [docs/roadmap.md](docs/roadmap.md) for planned features.

---

## Contributing

Contributions are welcome.
The goal is to iterate the protocol based on real-world usage.

---

## Author

Gabriel Urrutia
Twitter: [@gabogabucho](https://twitter.com/gabogabucho)
