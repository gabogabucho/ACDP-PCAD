# Prompt: Join an Existing ACDP Project

Use this prompt to instruct an AI agent to join a project that already uses ACDP and start contributing while respecting the coordination protocol.

---

## Prompt (copy and paste)

```
You are an AI agent joining an existing software project that uses ACDP (Agent Coordination Protocol for Development) for multi-agent coordination via a WebSocket coordination server.

Before writing ANY code, you MUST follow this onboarding sequence:

1. **Connect to the coordination server**:
   - Check if the ACDP MCP server is already configured. If using Claude Code, check `.mcp.json` in the project root. If using Claude Desktop, check `claude_desktop_config.json`.
   - If the MCP server is NOT configured, add it now. For Claude Code, create or edit `.mcp.json` in the project root:
     ```json
     {
       "mcpServers": {
         "acdp": {
           "command": "npx",
           "args": ["-y", "acdp-mcp-server"],
           "env": {
             "ACDP_AGENT_ID": "your-agent-id"
           }
         }
       }
     }
     ```
   - Replace `your-agent-id` with a unique identifier for this agent (e.g., `claude-agent-1`).
   - That's it. The MCP server auto-detects or starts the socket server on first use. No manual server setup needed — if no server is running, it starts one automatically with this machine as owner.
   - After adding the config, the MCP tools will be available: `check_locks`, `lock_files`, `release_files`, `request_commit`, `notify_sync`, `list_agents`.
   - **For remote teams**: If the socket server runs on a different machine, add `ACDP_SOCKET_URL` and `ACDP_TOKEN` env vars to connect to that specific server instead of auto-starting a local one.

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
   - After approval, commit and push your changes.
   - Call `notify_sync` with the changed files and a description. This notifies all other agents and auto-releases your locks.
   - Update your status to `idle` in `acdp/agents.md`.
   - Update `acdp/state.md` to reflect the current state.

CRITICAL RULES:
- NEVER skip MCP configuration. Without it you cannot coordinate with other agents.
- NEVER modify a file without holding its lock via `lock_files`.
- NEVER skip the `request_commit` step — commit approval is required.
- ALWAYS call `notify_sync` after committing so other agents know to pull.
- NEVER modify `acdp/protocol.md` or `acdp/governance.json` — these require owner approval.
- All coordination happens through the socket server via MCP tools. Do NOT edit `acdp/locks.json` manually.
```

---

## When to Use

- Bringing a second (or third) AI agent into an ongoing project
- Assigning a new task to a different AI tool (e.g., adding Claude to a project where Gemini is already working)
- A human developer wants an AI to help on a repo that uses ACDP
