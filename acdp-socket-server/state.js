const { v4: uuidv4 } = require('uuid');

class State {
  constructor({ defaultTtlMinutes = 15 } = {}) {
    this.locks = [];
    this.agents = [];
    this.pendingCommits = [];
    this.defaultTtlMinutes = defaultTtlMinutes;
  }

  // --- Agents ---

  registerAgent(agentId, machine, role = 'agent') {
    const existing = this.agents.find(
      a => a.agent_id === agentId && a.machine === machine
    );
    if (existing) {
      existing.status = 'connected';
      existing.connected_at = new Date().toISOString();
      existing.role = role;
      return existing;
    }

    const agent = {
      agent_id: agentId,
      machine,
      role,
      status: 'connected',
      connected_at: new Date().toISOString()
    };
    this.agents.push(agent);
    return agent;
  }

  disconnectAgent(agentId, machine) {
    const agent = this.agents.find(
      a => a.agent_id === agentId && a.machine === machine
    );
    if (agent) {
      agent.status = 'disconnected';
    }
  }

  getAgents() {
    return this.agents;
  }

  getConnectedAgents() {
    return this.agents.filter(a => a.status === 'connected');
  }

  // --- Locks ---

  acquireLock(files, agentId, machine, reason, ttlMinutes) {
    const ttl = ttlMinutes || this.defaultTtlMinutes;
    const conflicts = this.findConflicts(files, agentId);
    if (conflicts.length > 0) {
      return { acquired: false, conflicts };
    }

    const lock = {
      lock_id: uuidv4(),
      files,
      agent_id: agentId,
      machine,
      reason: reason || null,
      locked_at: new Date().toISOString(),
      ttl_minutes: ttl,
      expires_at: new Date(Date.now() + ttl * 60 * 1000).toISOString()
    };
    this.locks.push(lock);
    return { acquired: true, lock };
  }

  releaseLock(files, agentId) {
    const released = [];
    const notFound = [];

    for (const file of files) {
      const idx = this.locks.findIndex(
        l => l.files.includes(file) && l.agent_id === agentId
      );
      if (idx !== -1) {
        const lock = this.locks[idx];
        // Remove the file from the lock
        lock.files = lock.files.filter(f => f !== file);
        released.push(file);
        // If no files remain in the lock, remove it entirely
        if (lock.files.length === 0) {
          this.locks.splice(idx, 1);
        }
      } else {
        notFound.push(file);
      }
    }

    return { released, notFound };
  }

  releaseAllByAgent(agentId) {
    const agentLocks = this.locks.filter(l => l.agent_id === agentId);
    const releasedFiles = agentLocks.flatMap(l => l.files);
    this.locks = this.locks.filter(l => l.agent_id !== agentId);
    return releasedFiles;
  }

  findConflicts(files, excludeAgentId = null) {
    const now = new Date();
    const conflicts = [];

    for (const file of files) {
      for (const lock of this.locks) {
        if (excludeAgentId && lock.agent_id === excludeAgentId) continue;
        if (new Date(lock.expires_at) <= now) continue;
        if (lock.files.includes(file)) {
          conflicts.push({ file, lock });
        }
      }
    }
    return conflicts;
  }

  getLocks() {
    this.cleanupExpired();
    return this.locks;
  }

  cleanupExpired() {
    const now = new Date();
    const expired = this.locks.filter(l => new Date(l.expires_at) <= now);
    this.locks = this.locks.filter(l => new Date(l.expires_at) > now);
    return expired;
  }

  // --- Pending Commits ---

  addPendingCommit(requestId, agentId, files, summary) {
    const pending = {
      request_id: requestId,
      agent_id: agentId,
      files,
      summary,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    this.pendingCommits.push(pending);
    return pending;
  }

  resolvePendingCommit(requestId, approved, reason = null) {
    const pending = this.pendingCommits.find(p => p.request_id === requestId);
    if (!pending || pending.status !== 'pending') return null;

    pending.status = approved ? 'approved' : 'rejected';
    pending.resolved_at = new Date().toISOString();
    if (reason) pending.reason = reason;
    return pending;
  }

  getPendingCommits() {
    return this.pendingCommits.filter(p => p.status === 'pending');
  }

  cleanupExpiredPendingCommits(timeoutMinutes) {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const expired = this.pendingCommits.filter(
      p => p.status === 'pending' && new Date(p.created_at) <= cutoff
    );
    for (const p of expired) {
      p.status = 'rejected';
      p.reason = 'Approval timeout';
      p.resolved_at = new Date().toISOString();
    }
    return expired;
  }

  // --- Snapshot ---

  getSnapshot() {
    this.cleanupExpired();
    return {
      locks: this.locks,
      agents: this.agents,
      pending_commits: this.getPendingCommits()
    };
  }
}

module.exports = State;
