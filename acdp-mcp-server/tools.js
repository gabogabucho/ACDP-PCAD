const z = require('zod');

function registerTools(server, context, connectToServer) {
  server.tool(
    'connect_remote',
    'Connect to a remote ACDP coordination server on another machine. Use this when you need to coordinate with agents running on a different computer. You will need the server IP/hostname and the secret token (found in acdp-socket-server/config.json on the remote machine). ASK THE USER for these values if you do not have them.',
    {
      url: z.string().describe('WebSocket URL of the remote server (e.g., ws://192.168.1.10:3100)'),
      token: z.string().describe('Secret token for authentication (from the remote server config)')
    },
    async ({ url, token }) => {
      try {
        await connectToServer(url, token);
        return {
          content: [{
            type: 'text',
            text: `Connected to remote server at ${url}. You are now coordinating with agents on that machine. All coordination tools (check_locks, lock_files, etc.) now operate against the remote server.`
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Failed to connect to ${url}: ${err.message}\n\nVerify that:\n1. The server is running on the remote machine\n2. The IP and port are correct\n3. The token matches the one in the remote server's config.json\n4. The network allows connections on that port`
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'connection_status',
    'Check which coordination server you are currently connected to.',
    {},
    async () => {
      const url = context.currentUrl || 'unknown';
      const connected = context.socketClient && context.socketClient.connected;
      return {
        content: [{
          type: 'text',
          text: connected
            ? `Connected to: ${url}`
            : `Not connected (last known: ${url})`
        }]
      };
    }
  );

  server.tool(
    'check_locks',
    'List all active file locks. Shows which files are locked, by whom, and when they expire.',
    {},
    async () => {
      try {
        const locks = await context.commands.checkLocks();
        if (locks.length === 0) {
          return { content: [{ type: 'text', text: 'No active locks. All files are available.' }] };
        }
        const summary = locks.map(l =>
          `- ${l.files.join(', ')} — locked by ${l.agent_id} (${l.machine}) | reason: ${l.reason || 'none'} | expires: ${l.expires_at}`
        ).join('\n');
        return { content: [{ type: 'text', text: `Active locks:\n${summary}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'lock_files',
    'Lock files before modifying them. Other agents will see these files as unavailable. Fails if any file is already locked by another agent.',
    {
      files: z.array(z.string()).describe('Array of file paths to lock'),
      reason: z.string().optional().describe('Why you need these files')
    },
    async ({ files, reason }) => {
      try {
        const lock = await context.commands.lockFiles(files, reason);
        return {
          content: [{
            type: 'text',
            text: `Locked successfully:\n- Files: ${lock.files.join(', ')}\n- Lock ID: ${lock.lock_id}\n- Expires: ${lock.expires_at}`
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Lock failed: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'release_files',
    'Release your locks on files. Use this when you no longer need exclusive access.',
    {
      files: z.array(z.string()).describe('Array of file paths to release')
    },
    async ({ files }) => {
      try {
        await context.commands.releaseFiles(files);
        return { content: [{ type: 'text', text: `Released locks for: ${files.join(', ')}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Release failed: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'request_commit',
    'Request permission to commit changes to files. Auto-approved if you hold the lock and the files are not in a manual-approval path. Otherwise waits for owner approval.',
    {
      files: z.array(z.string()).describe('Array of file paths you are committing'),
      summary: z.string().optional().describe('Short description of changes')
    },
    async ({ files, summary }) => {
      try {
        const result = await context.commands.requestCommit(files, summary);
        if (result.status === 'approved') {
          return {
            content: [{
              type: 'text',
              text: `Commit approved for: ${files.join(', ')}. You may now commit your changes.`
            }]
          };
        }
        return {
          content: [{
            type: 'text',
            text: `Commit rejected: ${result.reason}`
          }],
          isError: true
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Commit request failed: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'notify_sync',
    'After committing changes, notify all other agents that these files have been updated. They will know to sync. This also auto-releases your locks on these files.',
    {
      files: z.array(z.string()).describe('Array of file paths that were changed'),
      message: z.string().optional().describe('Description of what changed')
    },
    async ({ files, message }) => {
      try {
        await context.commands.notifySync(files, message);
        return {
          content: [{
            type: 'text',
            text: `Sync notification sent for: ${files.join(', ')}. Locks auto-released.`
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Notify failed: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_agents',
    'List all agents registered on the coordination server and their connection status.',
    {},
    async () => {
      try {
        const agents = await context.commands.listAgents();
        if (agents.length === 0) {
          return { content: [{ type: 'text', text: 'No agents registered.' }] };
        }
        const summary = agents.map(a =>
          `- ${a.agent_id} (${a.machine}) — ${a.status} | role: ${a.role}`
        ).join('\n');
        return { content: [{ type: 'text', text: `Agents:\n${summary}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}

module.exports = { registerTools };
