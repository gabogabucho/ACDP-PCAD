# Prompt: Initialize a Project with ACDP

Use this prompt to instruct an AI agent to set up a new project with ACDP coordination from scratch.

---

## Prompt (copy and paste)

```
You are the lead agent initializing a new software project that uses ACDP (Agent Coordination Protocol for Development) for multi-agent coordination via a WebSocket coordination server.

Read the protocol at `acdp/protocol.md` to understand the rules.

Your tasks:

1. **Connect to the coordination server**:
   - Check if you have ACDP tools available (start_local, connect_remote, check_locks, lock_files, etc.).
   - If ACDP tools ARE available: call `start_local` to start a coordination server on this machine. You will become the owner.
   - If ACDP tools are NOT available: tell the user they need to install the ACDP MCP server first. The npm package is `acdp-mcp-server`. They must **manually edit** their Claude Code config file to add it — do NOT use `claude mcp add` CLI commands (they have known bugs with flag parsing). The config file locations are:
     - **Mac/Linux:** `~/.claude.json` — add inside `"mcpServers"` with command `npx`, args `["-y", "-p", "acdp-mcp-server", "acdp-mcp"]`
     - **Windows:** `~/.claude/.claude.json` or `~/.claude/mcp/acdp.json` — use `node` with absolute path to `bin/acdp-mcp.js` (run `npm install -g acdp-mcp-server` first, then `npm root -g` to find the path)
     - Do NOT create or modify any MCP config files yourself — the user must install the MCP themselves to avoid config conflicts.
   - After connecting, the coordination tools are active: `check_locks`, `lock_files`, `release_files`, `request_commit`, `notify_sync`, `list_agents`.

2. **Register yourself** as the first agent:
   - Add your entry to `acdp/agents.registry.json` with your id, role, and permissions.
   - Add yourself to `acdp/agents.md` with status `idle`.

3. **Define the project architecture**:
   - Update `acdp/architecture.md` with the actual module structure of this project.
   - Define module ownership (you are the initial owner of all modules).
   - Define restricted areas (at minimum: `acdp/`, config files, deploy scripts).

4. **Set governance**:
   - Update `acdp/governance.json` with the project name and yourself as owner and maintainer.
   - Set `"default_branch"` to the project's principal branch (e.g., `"default_branch": "main"`).

5. **Declare your first intent and acquire locks**:
   - Choose a task to start with.
   - Call `check_locks` to verify files are available.
   - Call `lock_files` with the files you will modify and a reason.
   - Update your status to `working` in `acdp/agents.md`.
   - Update `acdp/state.md` with the current system state.

6. **Work on your task**, following the protocol at all times:
   - Commit with conventional commits and agent tag: `type(scope): description [agent:your-id]`
   - Use branch naming: `agent/your-id/task-name`
   - Only modify files you have locked.

7. **When done**:
   - Call `request_commit` with the files you changed and a summary. Wait for approval.
   - After approval, commit your changes.
   - Call `notify_sync` with the changed files and a description. This notifies all other agents and auto-releases your locks.
   - Update `acdp/state.md` and your status in `acdp/agents.md`.

IMPORTANT RULES:
- Do NOT create or modify .mcp.json, ~/.claude.json, or any MCP config files. The MCP is pre-installed by the user.
- The FIRST thing you do is call `start_local` to start the coordination server.
- Always call `check_locks` before modifying any file.
- Never modify `acdp/governance.json` or `acdp/protocol.md` without owner approval.
- All coordination happens through the socket server via MCP tools. Do NOT edit `acdp/locks.json` manually.
- Always call `request_commit` before committing and `notify_sync` after committing.
```

---

## When to Use

- Starting a brand new project that will have multiple agents
- Converting an existing repo to use ACDP for the first time
- The AI is the first agent to work on the codebase
