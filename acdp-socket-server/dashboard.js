/**
 * Dashboard module for the ACDP socket server.
 *
 * Provides:
 *   - HTTP handler that serves `public/dashboard.html` and `/api/state`
 *   - A dedicated WebSocket server (`dashboard-ws`) that broadcasts state
 *     updates to connected dashboard clients after every state-changing event
 *
 * The dashboard is served on the same port as the agent WebSocket; upgrade
 * requests are routed by URL path in `index.js`.
 *
 * Authentication: dashboard WebSocket connections must include the shared
 * server token via `?token=...` query param, identical to agent auth.
 */

const fs = require('fs');
const path = require('path');
const url = require('url');
const { WebSocketServer } = require('ws');

const DASHBOARD_HTML = path.join(__dirname, 'public', 'dashboard.html');
const MAX_STREAM_EVENTS = 200;

class Dashboard {
  /**
   * @param {object} deps
   * @param {import('./state')} deps.state
   * @param {object} deps.auth        - auth instance with validateToken(token)
   * @param {object} deps.governance  - governance.json contents
   * @param {object} deps.startedAt   - Date when the process started
   */
  constructor({ state, auth, governance, startedAt }) {
    this.state = state;
    this.auth = auth;
    this.governance = governance;
    this.startedAt = startedAt || new Date();
    this.clients = new Set();
    this.eventStream = []; // Ring buffer of recent events for new dashboard clients
    this.metrics = {
      totalLocks: 0,
      totalCommits: 0,
      totalApprovals: 0,
      totalRejections: 0
    };

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => this._onConnection(ws));
  }

  /**
   * Express-style HTTP handler. Returns true if the request was handled.
   * Call from http.createServer request callback; fall through otherwise.
   */
  handleHttp(req, res) {
    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/' || parsed.pathname === '/dashboard' || parsed.pathname === '/dashboard.html') {
      this._serveDashboardHtml(req, res);
      return true;
    }

    if (parsed.pathname === '/api/state') {
      this._serveStateJson(req, res, parsed.query);
      return true;
    }

    if (parsed.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
        dashboard_clients: this.clients.size
      }));
      return true;
    }

    return false;
  }

  /**
   * WebSocket upgrade handler. Authenticates via `?token=...` query param.
   */
  handleUpgrade(req, socket, head) {
    const parsed = url.parse(req.url, true);
    const token = parsed.query?.token;

    if (!this.auth.validateToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  /**
   * Record a server event and push it to dashboard clients.
   * Called from index.js on every broadcast-worthy state change.
   *
   * @param {string} type        e.g. 'lock_acquired', 'agent_connected'
   * @param {object} payload     the original broadcast payload
   */
  recordEvent(type, payload = {}) {
    const event = {
      type,
      at: new Date().toISOString(),
      payload
    };

    this.eventStream.push(event);
    if (this.eventStream.length > MAX_STREAM_EVENTS) {
      this.eventStream.shift();
    }

    if (type === 'lock_acquired') this.metrics.totalLocks++;
    else if (type === 'commit_pending' || type === 'commit_approved') this.metrics.totalCommits++;
    if (type === 'commit_approved') this.metrics.totalApprovals++;
    if (type === 'commit_rejected') this.metrics.totalRejections++;

    this._broadcastSnapshot(event);
  }

  /**
   * Shut down dashboard WebSocket server cleanly.
   */
  close() {
    for (const client of this.clients) {
      try { client.close(); } catch {}
    }
    this.clients.clear();
    this.wss.close();
  }

  // --- Internal ---

  _onConnection(ws) {
    this.clients.add(ws);

    // Send initial snapshot + recent event stream
    this._send(ws, {
      type: 'init',
      snapshot: this._buildSnapshot(),
      events: this.eventStream.slice(-50)
    });

    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  _broadcastSnapshot(event) {
    if (this.clients.size === 0) return;

    const payload = JSON.stringify({
      type: 'update',
      snapshot: this._buildSnapshot(),
      event
    });

    for (const client of this.clients) {
      if (client.readyState === 1) {
        try { client.send(payload); } catch {}
      }
    }
  }

  _buildSnapshot() {
    const snap = this.state.getSnapshot();
    return {
      agents: snap.agents,
      locks: snap.locks,
      pending_commits: snap.pending_commits,
      metrics: { ...this.metrics },
      owner: this.governance?.project?.owner || null,
      sub_owner: this.governance?.project?.sub_owner || null,
      project_name: this.governance?.project?.name || 'ACDP',
      uptime_seconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      server_time: new Date().toISOString()
    };
  }

  _serveDashboardHtml(req, res) {
    fs.readFile(DASHBOARD_HTML, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Dashboard not built: ${err.message}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(html);
    });
  }

  _serveStateJson(req, res, query) {
    // Token required via ?token= for security (dashboard data leaks state)
    if (!this.auth.validateToken(query.token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(this._buildSnapshot(), null, 2));
  }

  _send(ws, obj) {
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch {}
    }
  }
}

module.exports = Dashboard;
