const WebSocket = require('ws');
const { EventEmitter } = require('events');

class AcdpSocketClient extends EventEmitter {
  constructor({ url, token, agentId, machine }) {
    super();
    this.url = url;
    this.token = token;
    this.agentId = agentId;
    this.machine = machine;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.baseReconnectDelay = 1000;
    this._pendingRequests = new Map();
    this._requestIdCounter = 0;
    this._shouldReconnect = true;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._shouldReconnect = true;
      this.ws = new WebSocket(this.url);

      const onFirstMessage = (raw) => {
        const data = JSON.parse(raw.toString());
        if (data.event === 'error') {
          this.ws.removeListener('message', onFirstMessage);
          reject(new Error(data.message));
          return;
        }
        if (data.event === 'state_sync') {
          this.ws.removeListener('message', onFirstMessage);
          this.connected = true;
          this.reconnectAttempts = 0;
          this._setupMessageHandler();
          this.emit('state_sync', data);
          resolve(data);
        }
      };

      this.ws.on('open', () => {
        this.ws.on('message', onFirstMessage);
        this.ws.send(JSON.stringify({
          action: 'register',
          agent_id: this.agentId,
          machine: this.machine,
          token: this.token
        }));
      });

      this.ws.on('close', (code) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.emit('disconnected', { code });

        if (this._shouldReconnect && wasConnected) {
          this._scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
        this.emit('error', err);
      });
    });
  }

  _setupMessageHandler() {
    this.ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Resolve pending requests if applicable
      this._resolvePending(data);

      // Emit typed events — use 'server_error' instead of 'error' to avoid
      // Node.js throwing on unhandled 'error' events from EventEmitter
      const eventName = data.event === 'error' ? 'server_error' : data.event;
      this.emit(eventName, data);
      this.emit('message', data);
    });
  }

  _resolvePending(data) {
    // Match commit approval/rejection to pending requests
    if (data.event === 'commit_approved' || data.event === 'commit_rejected') {
      for (const [id, pending] of this._pendingRequests) {
        if (pending.type === 'request_commit' || pending.type === 'request_commit_immediate') {
          this._pendingRequests.delete(id);
          pending.resolve(data);
          return;
        }
      }
    }

    if (data.event === 'commit_pending') {
      for (const [id, pending] of this._pendingRequests) {
        if (pending.type === 'request_commit_immediate') {
          this._pendingRequests.delete(id);
          pending.resolve(data);
          return;
        }
      }
    }

    // Match lock acquired/error to pending lock requests
    if (data.event === 'lock_acquired') {
      if (data.lock && data.lock.agent_id === this.agentId) {
        for (const [id, pending] of this._pendingRequests) {
          if (pending.type === 'lock') {
            this._pendingRequests.delete(id);
            pending.resolve(data);
            return;
          }
        }
      }
    }

    if (data.event === 'error') {
      // Resolve the oldest pending request with an error
      for (const [id, pending] of this._pendingRequests) {
        this._pendingRequests.delete(id);
        pending.reject(new Error(data.message));
        return;
      }
    }

    if (data.event === 'lock_released' && data.agent_id === this.agentId) {
      for (const [id, pending] of this._pendingRequests) {
        if (pending.type === 'release') {
          this._pendingRequests.delete(id);
          pending.resolve(data);
          return;
        }
      }
    }

    if (data.event === 'locks_list') {
      for (const [id, pending] of this._pendingRequests) {
        if (pending.type === 'check_locks') {
          this._pendingRequests.delete(id);
          pending.resolve(data);
          return;
        }
      }
    }

    if (data.event === 'agents_list') {
      for (const [id, pending] of this._pendingRequests) {
        if (pending.type === 'list_agents') {
          this._pendingRequests.delete(id);
          pending.resolve(data);
          return;
        }
      }
    }

    if (data.event === 'files_changed' && data.agent_id === this.agentId) {
      for (const [id, pending] of this._pendingRequests) {
        if (pending.type === 'notify_sync') {
          this._pendingRequests.delete(id);
          pending.resolve(data);
          return;
        }
      }
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect_failed');
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30_000
    );
    const jitter = Math.random() * delay * 0.3;

    this.reconnectAttempts++;
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay: delay + jitter });

    setTimeout(() => {
      this.connect().catch(() => {
        // reconnect will be rescheduled via the close handler
      });
    }, delay + jitter);
  }

  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }
    this.ws.send(JSON.stringify(data));
  }

  _sendWithResponse(action, data, type, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const id = ++this._requestIdCounter;
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for response to ${action}`));
      }, timeoutMs);

      this._pendingRequests.set(id, {
        type,
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      this.send({ action, ...data });
    });
  }

  disconnect() {
    this._shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = AcdpSocketClient;
