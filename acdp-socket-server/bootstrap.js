/**
 * Bootstrap utility for the ACDP socket server.
 *
 * Tries to connect to an existing server. If none is running,
 * auto-generates config and starts the server as a child process.
 *
 * Used by the MCP server to ensure zero-friction startup.
 */

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');

const SERVER_DIR = __dirname;
const CONFIG_PATH = path.join(SERVER_DIR, 'config.json');
const DEFAULT_PORT = 3100;

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  // Auto-generate config with this machine as owner
  const config = {
    port: DEFAULT_PORT,
    token: crypto.randomBytes(16).toString('hex'),
    owner: os.hostname(),
    sub_owner: null,
    manual_approval_paths: [],
    default_ttl_minutes: 15,
    pending_commit_timeout_minutes: 10
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return config;
}

function tryConnect(url, token, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timer);
      // Send a minimal register to verify the server responds
      ws.send(JSON.stringify({
        action: 'register',
        agent_id: '__probe__',
        machine: '__probe__',
        token
      }));
    });

    ws.on('message', () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function startServer(config) {
  const child = fork(path.join(SERVER_DIR, 'index.js'), [], {
    env: { ...process.env, ACDP_CONFIG: CONFIG_PATH },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  // Pipe server output to stderr (stdout is reserved for MCP stdio transport)
  child.stdout.on('data', (data) => {
    process.stderr.write(`[ACDP Server] ${data}`);
  });
  child.stderr.on('data', (data) => {
    process.stderr.write(`[ACDP Server] ${data}`);
  });

  child.unref();
  return child;
}

async function waitForServer(url, token, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 500));
    const alive = await tryConnect(url, token);
    if (alive) return true;
  }
  return false;
}

/**
 * Ensures a socket server is running. Returns the config to connect to.
 *
 * 1. Load or auto-generate config.json
 * 2. Try connecting to ws://127.0.0.1:<port>
 * 3. If server responds → return config (already running)
 * 4. If no server → start it as a detached child process, wait for it, return config
 */
async function ensureServer() {
  const config = loadOrCreateConfig();
  const url = `ws://127.0.0.1:${config.port}`;

  // Check if server is already running
  const alive = await tryConnect(url, config.token);
  if (alive) {
    return { config, url, started: false };
  }

  // Start the server
  console.error(`[ACDP Bootstrap] No server found at ${url}. Starting one...`);
  const child = startServer(config);

  const ready = await waitForServer(url, config.token);
  if (!ready) {
    child.kill();
    throw new Error(`Failed to start socket server on port ${config.port}`);
  }

  console.error(`[ACDP Bootstrap] Server started on ${url} (owner: ${config.owner})`);
  return { config, url, started: true, pid: child.pid };
}

module.exports = { ensureServer, loadOrCreateConfig, tryConnect };
