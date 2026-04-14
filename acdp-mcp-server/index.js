const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const AcdpSocketClient = require('../acdp-socket-client/index');
const AcdpCommands = require('../acdp-socket-client/commands');
const { ensureServer } = require('../acdp-socket-server/bootstrap');
const { registerTools } = require('./tools');
const { registerPrompts } = require('./prompts');

const AGENT_ID = process.env.ACDP_AGENT_ID || `agent-${require('os').hostname()}-${process.pid}`;
const MACHINE = process.env.ACDP_MACHINE || require('os').hostname();

// Optional overrides — if not provided, bootstrap auto-detects/starts the server
const SOCKET_URL_OVERRIDE = process.env.ACDP_SOCKET_URL || null;
const TOKEN_OVERRIDE = process.env.ACDP_TOKEN || null;

async function main() {
  let url, token;

  if (SOCKET_URL_OVERRIDE && TOKEN_OVERRIDE) {
    // Manual config — use provided URL and token directly
    url = SOCKET_URL_OVERRIDE;
    token = TOKEN_OVERRIDE;
    console.error(`[ACDP MCP] Using manual config: ${url}`);
  } else {
    // Auto-bootstrap: find or start the socket server
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

  // Connect to the socket server
  const socketClient = new AcdpSocketClient({
    url,
    token,
    agentId: AGENT_ID,
    machine: MACHINE
  });

  socketClient.on('error', (err) => {
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

  try {
    await socketClient.connect();
    console.error(`[ACDP MCP] Connected as ${AGENT_ID} (${MACHINE})`);
  } catch (err) {
    console.error(`[ACDP MCP] Failed to connect: ${err.message}`);
    process.exit(1);
  }

  const commands = new AcdpCommands(socketClient);

  // Create MCP server
  const mcpServer = new McpServer(
    { name: 'acdp-coordination', version: '0.4.0' },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions: 'This server provides file coordination tools for multi-agent development. Always check locks before modifying files, and notify after committing changes. Use the coordination-protocol prompt for full instructions.'
    }
  );

  registerTools(mcpServer, commands);
  registerPrompts(mcpServer);

  // Connect MCP server to stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[ACDP MCP] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[ACDP MCP] Fatal error:', err);
  process.exit(1);
});
