# Prompt: Initialize a Project with ACDP

Use this prompt to instruct an AI agent to set up a new project with ACDP coordination from scratch.

---

## Prompt (copy and paste)

```
You are the lead agent initializing a new software project that uses ACDP (Agent Coordination Protocol for Development) for multi-agent coordination.

Read the protocol at /acdp/protocol.md to understand the rules.

Your tasks:

1. **Register yourself** as the first agent:
   - Add your entry to `acdp/agents.registry.json` with your id, role, and permissions.
   - Add yourself to `acdp/agents.md` with status `idle`.
   - Append a `register` message to `acdp/events.log`.

2. **Define the project architecture**:
   - Update `acdp/architecture.md` with the actual module structure of this project.
   - Define module ownership (you are the initial owner of all modules).
   - Define restricted areas (at minimum: `acdp/`, config files, deploy scripts).

3. **Set governance**:
   - Update `acdp/governance.json` with the project name and yourself as owner and maintainer.

4. **Declare your first intent**:
   - Choose a task to start with.
   - Update your status to `working` in `acdp/agents.md`.
   - Update `acdp/state.md` with the current system state.
   - Append an `intent` message to `acdp/events.log`.

5. **Acquire locks** for the resources you will modify:
   - Add entries to `acdp/locks.json` with resource, scope, TTL, and reason.
   - Append `lock` messages to `acdp/events.log`.

6. **Work on your task**, following the protocol at all times:
   - Commit with conventional commits and agent tag: `type(scope): description [agent:your-id]`
   - Use branch naming: `agent/your-id/task-name`

7. **When done**, release locks, update state, and log completion:
   - Remove entries from `acdp/locks.json`.
   - Append `release` and `complete` messages to `acdp/events.log`.
   - Update `acdp/state.md` and your status in `acdp/agents.md`.

IMPORTANT RULES:
- Always read `acdp/locks.json` before modifying any file to check for active locks.
- Always declare intent BEFORE acquiring locks.
- Never modify `acdp/governance.json` or `acdp/protocol.md` without owner approval.
- All messages in `events.log` are append-only — never delete or modify past entries.
- Use structured JSON messages following the schema in `acdp/messages.schema.json`.
```

---

## When to Use

- Starting a brand new project that will have multiple agents
- Converting an existing repo to use ACDP for the first time
- The AI is the first agent to work on the codebase
