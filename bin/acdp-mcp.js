#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const AcdpSocketClient = require('../acdp-socket-client/index');
const AcdpCommands = require('../acdp-socket-client/commands');
const { ensureServer } = require('../acdp-socket-server/bootstrap');
const { registerTools } = require('../acdp-mcp-server/tools');
const { registerPrompts } = require('../acdp-mcp-server/prompts');

const AGENT_ID = process.env.ACDP_AGENT_ID || `agent-${require('os').hostname()}-${process.pid}`;
const MACHINE = process.env.ACDP_MACHINE || require('os').hostname();

// Optional overrides — if both are set, auto-connect on startup
const SOCKET_URL_OVERRIDE = process.env.ACDP_SOCKET_URL || null;
const TOKEN_OVERRIDE = process.env.ACDP_TOKEN || null;

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

async function startLocalServer() {
  console.error('[ACDP MCP] Starting local server...');
  const server = await ensureServer();
  const url = server.url;
  const token = server.config.token;
  if (server.started) {
    console.error(`[ACDP MCP] Started new server (pid: ${server.pid})`);
  } else {
    console.error(`[ACDP MCP] Found existing server at ${url}`);
  }
  await connectToServer(url, token);
  return { url, token: server.config.token };
}

async function main() {
  // If env vars are set, auto-connect on startup (backwards compatible)
  if (SOCKET_URL_OVERRIDE && TOKEN_OVERRIDE) {
    console.error(`[ACDP MCP] Using manual config: ${SOCKET_URL_OVERRIDE}`);
    await connectToServer(SOCKET_URL_OVERRIDE, TOKEN_OVERRIDE);
  } else {
    // Start WITHOUT connecting — agent decides via tools
    console.error('[ACDP MCP] Starting in disconnected mode. Use start_local or connect_remote to connect.');
  }

  // Create MCP server
  const mcpServer = new McpServer(
    { name: 'acdp-coordination', version: '0.6.0' },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions: `This server provides file coordination tools for multi-agent development.

IMPORTANT: On startup, you are NOT connected to any coordination server. You MUST connect first using one of these tools:
- Use "start_local" to start a local coordination server on this machine (you become the owner). Use this when YOU are the one hosting the coordination.
- Use "connect_remote" to connect to another machine's server. You need the IP address and secret token from the owner. ASK THE USER which one they want.

Once connected, use check_locks before modifying files, and notify_sync after committing changes. Use the coordination-protocol prompt for full instructions.`
    }
  );

  registerTools(mcpServer, context, connectToServer, startLocalServer);
  registerPrompts(mcpServer);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[ACDP MCP] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[ACDP MCP] Fatal error:', err);
  process.exit(1);
});
