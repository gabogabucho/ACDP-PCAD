<img width="991" height="564" alt="image" src="https://github.com/user-attachments/assets/c2b1a1ec-1faa-4b40-831d-081c8e1af178" />


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

ACDP has two layers: coordination (socket-based) and protocol files (in the repository).

```
/acdp-socket-server/       # WebSocket coordination server (runs on owner machine)
  index.js                 # Server entry point
  state.js                 # In-memory lock/agent state
  handlers.js              # Message handlers (lock, release, commit, etc.)
  approval-engine.js       # Auto/manual commit approval logic
  auth.js                  # Token auth + owner/sub-owner roles
  logger.js                # JSONL audit log
  config.json              # Server config (port, token, owner, approval paths)

/acdp-socket-client/       # Client library (used by MCP server)
  index.js                 # WebSocket client with auto-reconnect
  commands.js              # Promise-based command helpers

/acdp-mcp-server/          # MCP server (runs on each agent's machine)
  index.js                 # MCP entry point (stdio transport)
  tools.js                 # MCP tools: check_locks, lock_files, etc.
  prompts.js               # Coordination protocol prompt for AI agents

/acdp/                     # Protocol files (in the repository)
  protocol.md              # Coordination rules
  architecture.md          # Module map and ownership
  state.md                 # Current system snapshot
  agents.md                # Active agent roster
  governance.json          # Authority and override rules
  agents.registry.json     # Trusted agent definitions
  messages.schema.json     # JSON Schema for message validation
  prompts/
    init-project.md        # Prompt to initialize a project with ACDP
    join-project.md        # Prompt for an agent to join a project
```

---

## Visual Overview

```
        Owner Machine
        ┌───────────────────────────┐
        │   acdp-socket-server      │
        │   (WebSocket ws://:3100)  │
        │                           │
        │   Locks in memory         │
        │   Commit approval engine  │
        │   Audit log (JSONL)       │
        └─────────┬─────────────────┘
                  │ WebSocket
        ┌─────────┼─────────────┐
        │         │             │
        ▼         ▼             ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Machine │ │ Machine │ │ Machine │
   │    A    │ │    B    │ │    C    │
   │         │ │         │ │         │
   │ Agent   │ │ Agent   │ │ Agent   │
   │ + MCP   │ │ + MCP   │ │ + MCP   │
   └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │
        └───────────┼───────────┘
                    │
                    ▼
             Git Repository
            (code only)
```

### Agent workflow via MCP

1. Agent calls `check_locks` → sees available files
2. Agent calls `lock_files` → server locks, notifies all
3. Agent works locally on locked files
4. Agent calls `request_commit` → server approves
5. Agent commits and pushes to Git
6. Agent calls `notify_sync` → server notifies all, releases locks

---

## Workflow

1. Owner starts the socket server (`node acdp-socket-server/index.js`)
2. Agent configures MCP server (auto-configured via prompts — see `acdp/prompts/join-project.md`)
3. Agent reads protocol and registers in `acdp/agents.registry.json`
4. Agent calls `check_locks` to see available files
5. Agent calls `lock_files` for the files it needs
6. Agent works on its own branch
7. Agent calls `request_commit` and waits for approval
8. Agent commits and pushes
9. Agent calls `notify_sync` — locks auto-released, all agents notified

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

## Setup

### 1. Start the socket server (owner machine)

```bash
cd acdp-socket-server
npm install
# Edit config.json: set your hostname as owner, choose a token
node index.js
```

### 2. Agent self-configuration (automatic)

When an AI agent joins the project using `acdp/prompts/join-project.md`, it will:
1. Read `acdp-socket-server/config.json` to find the port and token
2. Add the MCP server config to `.mcp.json` (Claude Code) or the equivalent config file
3. Start using MCP tools (`check_locks`, `lock_files`, etc.) to coordinate

No manual MCP setup needed — the agent configures itself.

### 3. MCP Tools available to agents

| Tool | Description |
|------|-------------|
| `check_locks` | List all active file locks |
| `lock_files` | Lock files before modifying (fails if already locked) |
| `release_files` | Release your locks |
| `request_commit` | Request permission to commit (auto-approve or manual) |
| `notify_sync` | After commit: notify all agents, auto-release locks |
| `list_agents` | List connected agents and their status |

### 4. Commit approval

By default, `request_commit` auto-approves if the agent holds the lock for all requested files. Configure `manual_approval_paths` in `acdp-socket-server/config.json` to require manual owner approval for specific paths:

```json
{
  "manual_approval_paths": ["src/core/**", "config/**"]
}
```

### 5. Failover

If the owner machine is unavailable, the sub-owner (configured in `config.json`) can start the server on their machine. Agents reconnect automatically.

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
