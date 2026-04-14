function registerPrompts(server) {
  server.prompt(
    'coordination-protocol',
    'Instructions for how to coordinate file changes with other agents via the ACDP socket server',
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# ACDP Coordination Protocol

You are working in a multi-agent environment. Multiple AI agents may be modifying files in this project simultaneously. To prevent conflicts, you MUST follow this coordination protocol.

## Before modifying any file

1. Call \`check_locks\` to see which files are currently locked by other agents.
2. Identify which files you need to modify.
3. Call \`lock_files\` with the list of files you need and a reason.
   - If the lock succeeds, you have exclusive access. Proceed with your work.
   - If the lock fails (files already locked), do NOT modify those files. Tell the user which files are unavailable and suggest alternatives.

## While working

- Only modify files you have locked.
- If you discover you need additional files, lock them before modifying.
- Your locks have a TTL (time-to-live). If your work takes a long time, be aware that locks may expire.

## When you are done

1. Call \`request_commit\` with the files you changed and a short summary.
   - If approved, proceed to commit your changes.
   - If rejected, do not commit. Tell the user the reason.
2. After committing, call \`notify_sync\` with the changed files and a message describing what changed.
   - This notifies all other agents to sync and auto-releases your locks.

## Important rules

- NEVER modify a file you haven't locked.
- NEVER skip the commit approval step.
- ALWAYS notify after committing so other agents stay in sync.
- If you see a \`files_changed\` notification from another agent, be aware those files may have changed since you last read them.
- Call \`list_agents\` if you need to see who else is connected.

## MCP Installation (if asked to set up ACDP for another user or project)

When configuring the ACDP MCP server, **detect the operating system first**. The config differs:

**Mac / Linux** (\`.mcp.json\` or \`~/.claude.json\`):
\`\`\`json
{
  "mcpServers": {
    "acdp": {
      "command": "npx",
      "args": ["-y", "-p", "acdp-mcp-server", "acdp-mcp"],
      "env": { "ACDP_AGENT_ID": "your-agent-id" }
    }
  }
}
\`\`\`

**Windows** — for project scope (\`.mcp.json\`), use \`cmd /c\`:
\`\`\`json
{
  "mcpServers": {
    "acdp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "-p", "acdp-mcp-server", "acdp-mcp"],
      "env": { "ACDP_AGENT_ID": "your-agent-id" }
    }
  }
}
\`\`\`

**Windows** — for global scope, create \`~/.claude/mcp/acdp.json\` (flat format, NO \`mcpServers\` wrapper):
\`\`\`json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "-p", "acdp-mcp-server", "acdp-mcp"],
  "env": { "ACDP_AGENT_ID": "your-agent-id" }
}
\`\`\``
        }
      }]
    })
  );
}

module.exports = { registerPrompts };
