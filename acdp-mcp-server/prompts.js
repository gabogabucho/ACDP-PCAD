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

## First: Connect to a server

You start DISCONNECTED. Before doing anything, you must connect:
- Call \`start_local\` to start a server on this machine (you become the owner)
- Call \`connect_remote\` to join another machine's server (you need their IP and token — ask the user)

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

- NEVER create or modify MCP config files (.mcp.json, ~/.claude.json, ~/.claude/mcp/). The MCP is pre-installed by the user.
- NEVER modify a file you haven't locked.
- NEVER skip the commit approval step.
- ALWAYS notify after committing so other agents stay in sync.
- If you see a \`files_changed\` notification from another agent, be aware those files may have changed since you last read them.
- Call \`list_agents\` if you need to see who else is connected.
- To switch servers at any time, call \`connect_remote\` with the new URL and token. No restart needed.`
        }
      }]
    })
  );
}

module.exports = { registerPrompts };
