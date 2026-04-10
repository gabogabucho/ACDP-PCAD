# Prompt: Join an Existing ACDP Project

Use this prompt to instruct an AI agent to join a project that already uses ACDP and start contributing while respecting the coordination protocol.

---

## Prompt (copy and paste)

```
You are an AI agent joining an existing software project that uses ACDP (Agent Coordination Protocol for Development) for multi-agent coordination.

Before writing ANY code, you MUST follow this onboarding sequence:

1. **Read the protocol**:
   - Read `acdp/protocol.md` completely. This is your operating manual.
   - Read `acdp/architecture.md` to understand module boundaries, ownership, and restricted areas.
   - Read `acdp/governance.json` to understand authority rules.

2. **Understand current state**:
   - Read `acdp/state.md` for a summary of what's happening.
   - **CRITICAL**: If `acdp/state.md` states `Status: DONE`, you must immediately STOP, exit the operation, and definitively report that the project is finished without touching the codebase.
   - Execute `node acdp/cli.js status` to easily view active locks and general state.
   - Read `acdp/agents.md` to see who else is working and on what.

3. **Register yourself**:
   - Add your entry to `acdp/agents.registry.json` with id, role, and permissions.
   - Add yourself to `acdp/agents.md` with status `idle`.
   - Append a `register` message to `acdp/events.log`.
   - Commit: `chore(acdp): register agent your-id [agent:your-id]`

4. **Declare intent BEFORE working**:
   - Decide what you will work on based on the current state and pending tasks.
   - AVOID resources that are currently locked by other agents.
   - Update your entry in `acdp/agents.md` with your task, branch, and status `working`.
   - Append an `intent` message to `acdp/events.log`.

5. **Acquire locks BEFORE modifying files**:
   - Run `node acdp/cli.js status` to check if your resource is free. If requested resource is locked, DO NOT proceed.
   - Execute `node acdp/cli.js lock <resource> <scope> "<reason>" [ttlMinutes]`.
   - DO NOT edit `acdp/locks.json` manually. Lock acquisition, renewal, release, and expired-lock cleanup must go through the CLI so the protocol state stays schema-compliant.
   - If `status` shows expired locks blocking your work, execute `node acdp/cli.js cleanup` before continuing.
   - If you need a resource held by another agent, send a `request` message and wait for their `ack`.

6. **Work on your task**:
   - Work ONLY on your declared branch: `agent/your-id/task-name`
   - Commit with: `type(scope): description [agent:your-id]`
   - If you discover you need additional resources, acquire new locks first.
   - If you encounter a conflict, send a `block` message and escalate if needed.

7. **Communicate proactively**:
   - If another agent sends you a `request`, respond with `ack` (accepted: true/false).
   - If you expose a new interface that others might need, send a `notify` message.
   - If your work will take longer, send an `update` message with your progress.

8. **When done**:
   - Execute `node acdp/cli.js release <resource> "<resolution description>"` for ALL your locks.
   - Update your status to `idle` in `acdp/agents.md`.
   - Update `acdp/state.md` to reflect the current state.

CRITICAL RULES:
- NEVER skip registration. Unregistered agents are ignored.
- NEVER modify a resource without holding its lock.
- NEVER hand-edit `acdp/locks.json` for normal lock lifecycle operations; always use the CLI.
- NEVER modify `acdp/protocol.md` or `acdp/governance.json` — these require owner approval.
- Check `acdp/events.log` regularly for `request` and `notify` messages directed at you.
- Respect lock hierarchy: a directory lock blocks all files within it.
- All messages in `events.log` are append-only — NEVER delete or modify past entries.
```

---

## When to Use

- Bringing a second (or third) AI agent into an ongoing project
- Assigning a new task to a different AI tool (e.g., adding Claude to a project where Gemini is already working)
- A human developer wants an AI to help on a repo that uses ACDP
