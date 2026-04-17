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
const { URL } = require('url');
const WebSocket = require('ws');

const SERVER_DIR = __dirname;
const CONFIG_PATH = path.join(SERVER_DIR, 'config.json');
const PID_PATH = path.join(SERVER_DIR, '.server.pid');
const LOCK_PATH = path.join(SERVER_DIR, '.server.lock');
const MACHINE_ID_PATH = path.join(SERVER_DIR, '.machine-id');
const DEFAULT_PORT = 3100;
// Only true loopback destinations — 0.0.0.0 is a bind addr, not a client target.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

// ── Fix A: PID file + start lock helpers ─────────────────────────────────────
// Note: on Windows `process.kill(pid, 0)` has limited semantics vs POSIX; stale
// .server.pid may need manual cleanup if the server is force-killed.

function isAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid() {
  try { return parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10); } catch { return null; }
}

function writePid(pid) {
  try {
    fs.writeFileSync(PID_PATH, String(pid) + '\n', 'utf8');
  } catch (err) {
    // Surface write errors — silencing them hides the exact root-cause of the
    // startup loop this module is meant to prevent.
    console.error(`[ACDP Bootstrap] ERROR writing pidfile ${PID_PATH}: ${err.message}`);
  }
}

function clearPid() {
  try { fs.unlinkSync(PID_PATH); } catch {}
}

// Atomic start-lock: prevents two concurrent bootstraps from forking two servers.
// Lock contains the PID that owns it; stale locks (dead PID) are auto-cleaned.
function acquireStartLock() {
  try {
    const lockPid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8'), 10);
    if (!isAlive(lockPid)) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch {}
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

function releaseStartLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch {}
}

// ── Fix B: Loopback guard ────────────────────────────────────────────────────

function assertLoopback(url) {
  if (process.env.ACDP_ALLOW_REMOTE === '1') return;
  const host = new URL(url).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `[ACDP] refusing non-loopback URL "${host}". ` +
      `Set ACDP_ALLOW_REMOTE=1 to bypass (only for intentional remote setups).`
    );
  }
}

// ── Fix D: Stable machine-id ─────────────────────────────────────────────────

function loadMachineId() {
  try {
    const id = fs.readFileSync(MACHINE_ID_PATH, 'utf8').trim();
    if (id) return id;
  } catch {}
  const id = crypto.randomUUID();
  try { fs.writeFileSync(MACHINE_ID_PATH, id + '\n', 'utf8'); } catch {}
  return id;
}

// ── Config & governance ──────────────────────────────────────────────────────

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  const config = {
    port: DEFAULT_PORT,
    token: crypto.randomBytes(16).toString('hex'),
    manual_approval_paths: [],
    default_ttl_minutes: 15,
    pending_commit_timeout_minutes: 10
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return config;
}

/**
 * Load governance.json for owner/sub_owner (policy).
 * Env vars ACDP_OWNER / ACDP_SUB_OWNER take precedence (Fix C).
 */
function loadGovernance() {
  const paths = [
    process.env.ACDP_GOVERNANCE_PATH,
    path.join(process.cwd(), 'acdp', 'governance.json'),
    path.join(SERVER_DIR, '..', 'acdp', 'governance.json')
  ].filter(Boolean);

  let gov = null;
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        gov = JSON.parse(fs.readFileSync(p, 'utf8'));
        console.error(`[ACDP Bootstrap] Loaded governance from ${p}`);
        break;
      } catch (e) {
        console.error(`[ACDP Bootstrap] Warning: failed to parse ${p}: ${e.message}`);
      }
    }
  }

  if (!gov) {
    console.error('[ACDP Bootstrap] No governance.json found, using hostname as owner');
    gov = { project: { name: 'default', owner: os.hostname(), sub_owner: null } };
  }

  // Warn if governance owner won't match this machine (common pitfall after cloning).
  const currentMachine = process.env.ACDP_MACHINE || loadMachineId();
  const effectiveOwner = process.env.ACDP_OWNER || gov.project?.owner;
  if (effectiveOwner && effectiveOwner !== currentMachine && effectiveOwner !== os.hostname()) {
    console.error(
      `[ACDP] WARN: governance owner "${effectiveOwner}" doesn't match this machine ` +
      `(hostname=${os.hostname()}, machine-id=${currentMachine.slice(0, 8)}…). ` +
      `Set ACDP_OWNER env or edit acdp/governance.json to claim owner role.`
    );
  }

  return gov;
}

// ── Probe & start ────────────────────────────────────────────────────────────

// Probe: send a NON-register first message. The server always replies with
// "First message must be a register action" — that reply proves the server is
// alive without registering a ghost agent (no agent_connected events fired).
// `token` is accepted for API compatibility but not sent over the wire.
function tryConnect(url, _token, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ action: '__probe__' }));
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
    env: {
      ...process.env,
      ACDP_CONFIG: CONFIG_PATH,
      ACDP_PID_FILE: PID_PATH  // Child cleans its own pidfile on SIGINT
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  child.stdout.on('data', (data) => process.stderr.write(`[ACDP Server] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[ACDP Server] ${data}`));

  child.unref();
  return child;
}

async function waitForServer(url, token, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await tryConnect(url, token)) return true;
  }
  return false;
}

/**
 * Ensures a socket server is running. Returns the config to connect to.
 * Order: stale PID cleanup → probe → acquire start lock → fork or wait.
 *
 * The start lock prevents the race where two MCP instances launch at once,
 * both fail the probe, both fork a server, and the second loses port 3100.
 */
async function ensureServer() {
  const config = loadOrCreateConfig();
  const governance = loadGovernance();
  const url = `ws://127.0.0.1:${config.port}`;
  assertLoopback(url);

  // Fix A: stale PID cleanup (informational; not a functional gate)
  const existingPid = readPid();
  if (existingPid && !isAlive(existingPid)) {
    console.error(`[ACDP Bootstrap] Stale pidfile for dead PID ${existingPid}. Cleaning up.`);
    clearPid();
  }

  if (await tryConnect(url, config.token)) {
    return { config, governance, url, started: false, pid: existingPid };
  }

  // Need to start a server — serialize with a filesystem lock.
  if (!acquireStartLock()) {
    console.error('[ACDP Bootstrap] Another instance is starting the server. Waiting...');
    const ready = await waitForServer(url, config.token, 20);
    if (ready) {
      return { config, governance, url, started: false, pid: readPid() };
    }
    throw new Error('Another instance held the start lock but the server never came up.');
  }

  try {
    console.error(`[ACDP Bootstrap] No server found at ${url}. Starting one...`);
    const child = startServer(config);
    writePid(child.pid);

    const ready = await waitForServer(url, config.token);
    if (!ready) {
      child.kill();
      clearPid();
      throw new Error(`Failed to start socket server on port ${config.port}`);
    }

    const owner = process.env.ACDP_OWNER || governance.project?.owner || os.hostname();
    console.error(`[ACDP Bootstrap] Server started on ${url} (pid ${child.pid}, owner: ${owner})`);
    return { config, governance, url, started: true, pid: child.pid };
  } finally {
    releaseStartLock();
  }
}

module.exports = {
  ensureServer,
  loadOrCreateConfig,
  loadGovernance,
  tryConnect,
  loadMachineId,
  assertLoopback,
  PID_PATH
};
