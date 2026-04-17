#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const AcdpSocketClient = require('../acdp-socket-client/index');
const AcdpCommands = require('../acdp-socket-client/commands');
const { ensureServer, loadMachineId, assertLoopback } = require('../acdp-socket-server/bootstrap');
const { registerTools } = require('./tools');
const { registerPrompts } = require('./prompts');

// Identity split:
//   AGENT_ID  — ephemeral per MCP process (includes pid so each Claude session is
//               a distinct agent in locks/commits history).
//   MACHINE   — STABLE across restarts/network changes via .machine-id. Used for
//               role resolution against governance.owner — matches ACDP_OWNER env.
const AGENT_ID = process.env.ACDP_AGENT_ID || `agent-${require('os').hostname()}-${process.pid}`;
const MACHINE = process.env.ACDP_MACHINE || loadMachineId();

// Optional overrides — if not provided, bootstrap auto-detects/starts the server
const SOCKET_URL_OVERRIDE = process.env.ACDP_SOCKET_URL || null;
const TOKEN_OVERRIDE = process.env.ACDP_TOKEN || null;

// Guard against accidentally connecting to a non-loopback URL (Fix B)
if (SOCKET_URL_OVERRIDE) {
  assertLoopback(SOCKET_URL_OVERRIDE);
}

// Shared state — tools access these via the context object
const context = {
  socketClient: null,
  commands: null,
  currentUrl: null
};

async function connectToServer(url, token) {
  // Disconnect existing client if any
  if (context.socketClient) {
    try { context.socketClient.disconnect(); } catch {}
  }

  const socketClient = new AcdpSocketClient({
    url,
    token,
    agentId: AGENT_ID,
    machine: MACHINE
  });

  socketClient.on('server_error', (err) => {
    console.error('[ACDP MCP] Socket error:', err.message);
  });

  socketClient.on('reconnecting', ({ attempt, delay }) => {
    console.error(`[ACDP MCP] Reconnecting (attempt ${attempt}, delay ${Math.round(delay)}ms)`);
  });

  socketClient.on('files_changed', (data) => {
    if (data.agent_id !== AGENT_ID) {
      console.error(`[ACDP MCP] Files changed by ${data.agent_id}: ${data.files.join(', ')} — ${data.message}`);
    }
  });

  await socketClient.connect();

  context.socketClient = socketClient;
  context.commands = new AcdpCommands(socketClient);
  context.currentUrl = url;

  console.error(`[ACDP MCP] Connected as ${AGENT_ID} (${MACHINE}) to ${url}`);
}

async function main() {
  let url, token;

  if (SOCKET_URL_OVERRIDE && TOKEN_OVERRIDE) {
    url = SOCKET_URL_OVERRIDE;
    token = TOKEN_OVERRIDE;
    console.error(`[ACDP MCP] Using manual config: ${url}`);
  } else {
    console.error('[ACDP MCP] Auto-bootstrapping socket server...');
    const server = await ensureServer();
    url = server.url;
    token = server.config.token;
    if (server.started) {
      console.error(`[ACDP MCP] Started new server (pid: ${server.pid})`);
    } else {
      console.error(`[ACDP MCP] Found existing server at ${url}`);
    }
  }

  await connectToServer(url, token);

  // Create MCP server
  const mcpServer = new McpServer(
    { name: 'acdp-coordination', version: '0.5.0' },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions: `This server provides file coordination tools for multi-agent development. Always check locks before modifying files, and notify after committing changes.

IMPORTANT: You are currently connected to a LOCAL coordination server. If the user wants to coordinate with agents on another machine, use the connect_remote tool to connect to that machine's socket server — you will need to ask the user for the IP address and the secret token.

Use the coordination-protocol prompt for full instructions.`
    }
  );

  registerTools(mcpServer, context, connectToServer);
  registerPrompts(mcpServer);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[ACDP MCP] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[ACDP MCP] Fatal error:', err);
  process.exit(1);
});
