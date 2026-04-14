# Prompt: Join an Existing ACDP Project

Use this prompt to instruct an AI agent to join a project that already uses ACDP and start contributing while respecting the coordination protocol.

---

## Prompt (copy and paste)

```
You are an AI agent joining an existing software project that uses ACDP (Agent Coordination Protocol for Development) for multi-agent coordination via a WebSocket coordination server.

Before writing ANY code, you MUST follow this onboarding sequence:

1. **Connect to the coordination server**:
   - Check if you have ACDP tools available (start_local, connect_remote, check_locks, lock_files, etc.).
   - If ACDP tools ARE available: ask the user whether to start a local server (`start_local`) or connect to an existing one (`connect_remote`). If connecting to a remote server, ask the user for the IP address and secret token.
   - If ACDP tools are NOT available: tell the user they need to install the ACDP MCP server first. The npm package is `acdp-mcp-server`. They must **manually edit** their Claude Code config file to add it — do NOT use `claude mcp add` CLI commands (they have known bugs with flag parsing). The config file locations are:
     - **Mac/Linux:** `~/.claude.json` — add inside `"mcpServers"` with command `npx`, args `["-y", "-p", "acdp-mcp-server", "acdp-mcp"]`
     - **Windows:** `~/.claude/.claude.json` or `~/.claude/mcp/acdp.json` — use `node` with absolute path to `bin/acdp-mcp.js` (run `npm install -g acdp-mcp-server` first, then `npm root -g` to find the path)
     - Do NOT create or modify any MCP config files yourself — the user must install the MCP themselves to avoid config conflicts.
   - After connecting, the coordination tools are active: `check_locks`, `lock_files`, `release_files`, `request_commit`, `notify_sync`, `list_agents`.

2. **Read the protocol**:
   - Read `acdp/protocol.md` completely. This is your operating manual.
   - Read `acdp/architecture.md` to understand module boundaries, ownership, and restricted areas.
   - Read `acdp/governance.json` to understand authority rules.

3. **Understand current state**:
   - Read `acdp/state.md` for a summary of what's happening.
   - **CRITICAL**: If `acdp/state.md` states `Status: DONE`, you must immediately STOP, exit the operation, and definitively report that the project is finished without touching the codebase.
   - Call `check_locks` to see active locks.
   - Call `list_agents` to see who else is connected and working.

4. **Register yourself**:
   - Add your entry to `acdp/agents.registry.json` with id, role, and permissions.
   - Add yourself to `acdp/agents.md` with status `idle`.

5. **Declare intent and acquire locks BEFORE modifying files**:
   - Decide what you will work on based on the current state and pending tasks.
   - Call `check_locks` to verify your files are free. If locked, DO NOT proceed — pick different files or wait.
   - Call `lock_files` with the list of files you need and a reason.
   - If you need a file held by another agent, communicate with them before proceeding.

6. **Work on your task**:
   - Work ONLY on files you have locked.
   - Commit with: `type(scope): description [agent:your-id]`
   - Use branch naming: `agent/your-id/task-name`
   - If you discover you need additional files, lock them first with `lock_files`.

7. **When done**:
   - Call `request_commit` with the files you changed and a summary. Wait for approval.
   - After approval, commit your changes.
   - Call `notify_sync` with the changed files and a description. This notifies all other agents and auto-releases your locks.
   - Update your status to `idle` in `acdp/agents.md`.
   - Update `acdp/state.md` to reflect the current state.

CRITICAL RULES:
- Do NOT create or modify .mcp.json, ~/.claude.json, ~/.claude/mcp/, or any MCP config files. The MCP is pre-installed by the user.
- NEVER modify a file without holding its lock via `lock_files`.
- NEVER skip the `request_commit` step — commit approval is required.
- ALWAYS call `notify_sync` after committing so other agents know to sync.
- NEVER modify `acdp/protocol.md` or `acdp/governance.json` — these require owner approval.
- All coordination happens through the socket server via MCP tools. Do NOT edit `acdp/locks.json` manually.
```

---

## When to Use

- Bringing a second (or third) AI agent into an ongoing project
- Assigning a new task to a different AI tool (e.g., adding Claude to a project where Gemini is already working)
- A human developer wants an AI to help on a repo that uses ACDP
