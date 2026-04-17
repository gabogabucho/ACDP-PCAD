const http = require('http');
const url = require('url');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const State = require('./state');
const Auth = require('./auth');
const ApprovalEngine = require('./approval-engine');
const Logger = require('./logger');
const Handlers = require('./handlers');
const Dashboard = require('./dashboard');
const { loadGovernance } = require('./bootstrap');

const configPath = process.env.ACDP_CONFIG || path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const governance = loadGovernance();

const state = new State({ defaultTtlMinutes: config.default_ttl_minutes });
const auth = new Auth(config, governance);
const logger = new Logger();
const approvalEngine = new ApprovalEngine(config, state, logger);
const startedAt = new Date();
const dashboard = new Dashboard({ state, auth, governance, startedAt });

// Client registry: agentId → { ws, machine, agentId, role }
const clients = new Map();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const [, client] of clients) {
    if (client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
  // Mirror all broadcasts to the dashboard for real-time state visualization
  if (data && data.event) {
    dashboard.recordEvent(data.event, data);
  }
}

function sendTo(agentId, data) {
  const client = clients.get(agentId);
  if (client && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(data));
  }
}

const handlers = new Handlers(state, auth, approvalEngine, logger, broadcast, sendTo);

// --- HTTP server (serves dashboard + /api/state) ---
const httpServer = http.createServer((req, res) => {
  if (dashboard.handleHttp(req, res)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// --- WebSocket server for agents ---
const wss = new WebSocketServer({ noServer: true });

// --- Upgrade routing: agents → /, dashboard → /dashboard-ws ---
httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = url.parse(req.url);

  if (pathname === '/dashboard-ws') {
    dashboard.handleUpgrade(req, socket, head);
    return;
  }

  // Default: agent protocol (preserves backward compatibility with existing clients)
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  let clientInfo = null;

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ event: 'error', message: 'Invalid JSON' }));
      return;
    }

    // First message must be register
    if (!clientInfo) {
      if (message.action !== 'register') {
        ws.send(JSON.stringify({ event: 'error', message: 'First message must be a register action' }));
        return;
      }

      const { agent_id, machine, token } = message;

      if (!agent_id || !machine) {
        ws.send(JSON.stringify({ event: 'error', message: 'agent_id and machine are required' }));
        return;
      }

      if (!auth.validateToken(token)) {
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid token' }));
        ws.close(4001, 'Unauthorized');
        return;
      }

      const role = auth.getRole(machine);
      clientInfo = { agentId: agent_id, machine, role, ws };
      clients.set(agent_id, clientInfo);

      state.registerAgent(agent_id, machine, role);
      logger.agentConnected(agent_id, machine);

      // Send full state snapshot
      ws.send(JSON.stringify({
        event: 'state_sync',
        ...state.getSnapshot(),
        your_role: role
      }));

      // Notify others
      broadcast({
        event: 'agent_connected',
        agent_id,
        machine,
        role
      });

      console.log(`[ACDP] Agent '${agent_id}' connected from '${machine}' (role: ${role})`);
      return;
    }

    // Handle regular messages
    handlers.handle(ws, message, clientInfo);
  });

  ws.on('close', () => {
    if (clientInfo) {
      clients.delete(clientInfo.agentId);
      state.disconnectAgent(clientInfo.agentId, clientInfo.machine);
      logger.agentDisconnected(clientInfo.agentId, clientInfo.machine);

      broadcast({
        event: 'agent_disconnected',
        agent_id: clientInfo.agentId,
        machine: clientInfo.machine
      });

      console.log(`[ACDP] Agent '${clientInfo.agentId}' disconnected`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[ACDP] WebSocket error:`, err.message);
  });
});

// Start timeout checker for pending commits
approvalEngine.startTimeoutChecker((expired) => {
  sendTo(expired.agent_id, {
    event: 'commit_rejected',
    request_id: expired.request_id,
    reason: 'Approval timeout'
  });
});

// Periodic lock TTL cleanup
setInterval(() => {
  const expired = state.cleanupExpired();
  for (const lock of expired) {
    logger.lockReleased(lock.agent_id, lock.files);
    broadcast({
      event: 'lock_released',
      files: lock.files,
      agent_id: lock.agent_id,
      reason: 'TTL expired'
    });
    console.log(`[ACDP] Lock expired for '${lock.agent_id}': ${lock.files.join(', ')}`);
  }
}, 30_000);

// Start listening on the configured port
httpServer.listen(config.port, () => {
  const ownerName = governance.project?.owner || os.hostname();
  const subOwnerName = governance.project?.sub_owner;
  console.log(`[ACDP] Socket server listening on ws://0.0.0.0:${config.port}`);
  console.log(`[ACDP] Dashboard available at http://localhost:${config.port}/dashboard`);
  console.log(`[ACDP] Owner: ${ownerName}${subOwnerName ? `, Sub-owner: ${subOwnerName}` : ''}`);
  if (config.manual_approval_paths && config.manual_approval_paths.length > 0) {
    console.log(`[ACDP] Manual approval paths: ${config.manual_approval_paths.join(', ')}`);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[ACDP] Shutting down...');
  approvalEngine.stop();
  dashboard.close();
  wss.close();
  httpServer.close(() => {
    console.log('[ACDP] Server closed.');
    process.exit(0);
  });
});
