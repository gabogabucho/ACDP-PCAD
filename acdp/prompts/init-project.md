# Prompt: Initialize a Project with ACDP

Use this prompt to instruct an AI agent to set up a new project with ACDP coordination from scratch.

---

## Prompt (copy and paste)

```
You are the lead agent initializing a new software project that uses ACDP (Agent Coordination Protocol for Development) for multi-agent coordination via a WebSocket coordination server.

Read the protocol at `acdp/protocol.md` to understand the rules.

Your tasks:

1. **Configure the coordination server connection**:
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
   - Replace `your-agent-id` with a unique identifier (e.g., `claude-lead-agent`).
   - That's it. The MCP server auto-starts the socket server on first use with this machine as owner. A random secure token is generated automatically in `acdp-socket-server/config.json`.
   - After adding the config, the MCP tools will be available: `check_locks`, `lock_files`, `release_files`, `request_commit`, `notify_sync`, `list_agents`.

2. **Register yourself** as the first agent:
   - Add your entry to `acdp/agents.registry.json` with your id, role, and permissions.
   - Add yourself to `acdp/agents.md` with status `idle`.

3. **Define the project architecture**:
   - Update `acdp/architecture.md` with the actual module structure of this project.
   - Define module ownership (you are the initial owner of all modules).
   - Define restricted areas (at minimum: `acdp/`, `acdp-socket-server/`, config files, deploy scripts).

4. **Set governance**:
   - Update `acdp/governance.json` with the project name and yourself as owner and maintainer.
   - Set `"default_branch"` to the project's principal branch (e.g., `"default_branch": "main"`).
   - Configure `acdp-socket-server/config.json` with the correct `owner` hostname, `sub_owner` if applicable, and any `manual_approval_paths` for files that require human approval before committing.

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
   - After approval, commit and push your changes.
   - Call `notify_sync` with the changed files and a description. This notifies all other agents and auto-releases your locks.
   - Update `acdp/state.md` and your status in `acdp/agents.md`.

IMPORTANT RULES:
- The FIRST thing you do is configure the MCP server connection. Without it you cannot coordinate.
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
