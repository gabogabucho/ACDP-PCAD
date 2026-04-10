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
  events.log             # Structured JSON message log
  locks.json             # Active resource locks
  governance.json        # Authority and override rules
  agents.registry.json   # Trusted agent definitions
  messages.schema.json   # JSON Schema for message validation
  prompts/
    init-project.md      # Prompt to start a project with ACDP
    join-project.md      # Prompt for an agent to join a project
  examples/
    simulation-php.md    # Full simulation with 3 agents
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
                │   │  state.md                │◄──────────┐
                │   │  agents.md               │◄───────┐  │
                │   │  locks.json              │◄────┐  │  │
                │   │  events.log (JSON)       │◄──┐ │  │  │
                │   │  governance.json         │   │ │  │  │
                │   │  agents.registry.json    │   │ │  │  │
                │   │                          │   │ │  │  │
                │   └──────────────────────────┘   │ │  │  │
                │                                  │ │  │  │
                └──────────────────────────────────┘ │ │  │  │
                                                     │ │  │  │
        ┌──────────────┐       ┌──────────────┐      │ │  │  │
        │   Agent 01   │       │   Agent 02   │      │ │  │  │
        │ (AI / human) │       │ (AI / human) │      │ │  │  │
        └──────┬───────┘       └──────┬───────┘      │ │  │  │
               │                      │              │ │  │  │
               │  read state          │              │ │  │  │
               ├──────────────────────┼──────────────┘ │  │  │
               │                      │                │  │  │
               │  declare intent      │                │  │  │
               ├──────────────────────┼────────────────┘  │  │
               │                      │                   │  │
               │  acquire lock        │                   │  │
               ├──────────────────────┼───────────────────┘  │
               │                      │                      │
               │  modify code         │                      │
               ├──────────────────────┤                      │
               │                      │                      │
               │  release lock        │                      │
               ├──────────────────────┼──────────────────────┘
               │                      │
               │  update state        │
               └──────────────────────┘
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

---

## Project Status

Version: v0.1 (experimental)

ACDP is in its initial stage, oriented toward practical validation in real environments.

---

## Contributing

Contributions are welcome.
The goal is to iterate the protocol based on real-world usage.

---

## Author

Gabriel Urrutia
Twitter: [@gabogabucho](https://twitter.com/gabogabucho)
