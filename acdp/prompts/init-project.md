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
   - Set `"default_branch"` to the project's principal branch (e.g., `"default_branch": "main"`). This is required — the CLI reads it to record the base branch on every lock.
   - Create and push the coordination branch: `git checkout --orphan acdp/state && git rm -rf . && cp -r acdp/ . && git add acdp/ && git commit -m "chore(acdp): init coordination branch" && git push origin acdp/state && git checkout main`. Verify with `node acdp/cli.js doctor`.

4. **Declare your first intent**:
   - Choose a task to start with.
   - Update your status to `working` in `acdp/agents.md`.
   - Update `acdp/state.md` with the current system state.
   - Append an `intent` message to `acdp/events.log`.

5. **Acquire locks** for the resources you will modify:
   - Execute: `node acdp/cli.js lock <resource> <scope> "<reason>"` for each file. This automatically manages the intent, locks, and events logging without manual JSON parsing.

6. **Work on your task**, following the protocol at all times:
   - Commit with conventional commits and agent tag: `type(scope): description [agent:your-id]`
   - Use branch naming: `agent/your-id/task-name`

7. **When done**, release locks, update state, and log completion:
   - Execute: `node acdp/cli.js release <resource> "<completion_message>"` for each file.
   - Update `acdp/state.md` and your status in `acdp/agents.md`.
   - If you are marking the entire project lifecycle as finished, execute `node acdp/cli.js finish`.

IMPORTANT RULES:
- Always run `node acdp/cli.js status` before modifying any file to check for active locks.
- Always declare intent BEFORE acquiring locks (handled automatically by the CLI).
- Never modify `acdp/governance.json` or `acdp/protocol.md` without owner approval.
- Use `node acdp/cli.js lock` and `node acdp/cli.js release` — the old `-remote` variants no longer exist.
- All lock/release/cleanup operations publish directly to `origin/acdp/state` so all agents see changes in real time.
- We strongly recommend using `node acdp/cli.js` instead of modifying `events.log` manually to preserve JSONL integrity.
- Use structured JSON messages following the schema in `acdp/messages.schema.json`.
```

---

## When to Use

- Starting a brand new project that will have multiple agents
- Converting an existing repo to use ACDP for the first time
- The AI is the first agent to work on the codebase
