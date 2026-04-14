const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const AcdpSocketClient = require('../acdp-socket-client/index');
const AcdpCommands = require('../acdp-socket-client/commands');
const { registerTools } = require('./tools');
const { registerPrompts } = require('./prompts');

const SOCKET_URL = process.env.ACDP_SOCKET_URL;
const AGENT_ID = process.env.ACDP_AGENT_ID;
const MACHINE = process.env.ACDP_MACHINE || require('os').hostname();
const TOKEN = process.env.ACDP_TOKEN;

if (!SOCKET_URL || !AGENT_ID || !TOKEN) {
  console.error('Required env vars: ACDP_SOCKET_URL, ACDP_AGENT_ID, ACDP_TOKEN');
  process.exit(1);
}

async function main() {
  // Connect to the ACDP socket server
  const socketClient = new AcdpSocketClient({
    url: SOCKET_URL,
    token: TOKEN,
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
    console.error(`[ACDP MCP] Connected to ${SOCKET_URL} as ${AGENT_ID}`);
  } catch (err) {
    console.error(`[ACDP MCP] Failed to connect: ${err.message}`);
    process.exit(1);
  }

  const commands = new AcdpCommands(socketClient);

  // Create MCP server
  const mcpServer = new McpServer(
    { name: 'acdp-coordination', version: '0.1.0' },
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
