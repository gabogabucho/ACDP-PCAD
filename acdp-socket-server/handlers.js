class Handlers {
  constructor(state, auth, approvalEngine, logger, broadcast, sendTo) {
    this.state = state;
    this.auth = auth;
    this.approvalEngine = approvalEngine;
    this.logger = logger;
    this.broadcast = broadcast;
    this.sendTo = sendTo;
  }

  handle(ws, message, clientInfo) {
    const { action } = message;

    switch (action) {
      case 'lock':
        return this.handleLock(ws, message, clientInfo);
      case 'release':
        return this.handleRelease(ws, message, clientInfo);
      case 'check_locks':
        return this.handleCheckLocks(ws);
      case 'request_commit':
        return this.handleRequestCommit(ws, message, clientInfo);
      case 'approve_commit':
        return this.handleApproveCommit(ws, message, clientInfo);
      case 'reject_commit':
        return this.handleRejectCommit(ws, message, clientInfo);
      case 'notify_sync':
        return this.handleNotifySync(ws, message, clientInfo);
      case 'list_agents':
        return this.handleListAgents(ws);
      default:
        this.send(ws, { event: 'error', message: `Unknown action: ${action}` });
    }
  }

  handleLock(ws, message, clientInfo) {
    const { files, reason, ttl_minutes } = message;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return this.send(ws, { event: 'error', message: 'files[] is required' });
    }

    const result = this.state.acquireLock(
      files,
      clientInfo.agentId,
      clientInfo.machine,
      reason,
      ttl_minutes
    );

    if (!result.acquired) {
      return this.send(ws, {
        event: 'error',
        message: 'Files already locked',
        conflicts: result.conflicts.map(c => ({
          file: c.file,
          locked_by: c.lock.agent_id,
          machine: c.lock.machine,
          expires_at: c.lock.expires_at
        }))
      });
    }

    this.logger.lockAcquired(clientInfo.agentId, files, reason);

    this.broadcast({
      event: 'lock_acquired',
      lock: result.lock
    });
  }

  handleRelease(ws, message, clientInfo) {
    const { files } = message;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return this.send(ws, { event: 'error', message: 'files[] is required' });
    }

    const result = this.state.releaseLock(files, clientInfo.agentId);

    if (result.notFound.length > 0 && result.released.length === 0) {
      return this.send(ws, {
        event: 'error',
        message: `No locks found for files: ${result.notFound.join(', ')}`
      });
    }

    if (result.released.length > 0) {
      this.logger.lockReleased(clientInfo.agentId, result.released);

      this.broadcast({
        event: 'lock_released',
        files: result.released,
        agent_id: clientInfo.agentId
      });
    }
  }

  handleCheckLocks(ws) {
    const locks = this.state.getLocks();
    this.send(ws, { event: 'locks_list', locks });
  }

  handleRequestCommit(ws, message, clientInfo) {
    const { files, summary } = message;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return this.send(ws, { event: 'error', message: 'files[] is required' });
    }

    const result = this.approvalEngine.evaluateCommitRequest(
      clientInfo.agentId,
      files,
      summary || ''
    );

    if (result.status === 'rejected') {
      return this.send(ws, {
        event: 'commit_rejected',
        reason: result.reason
      });
    }

    if (result.status === 'pending') {
      // Notify the requesting agent
      this.send(ws, {
        event: 'commit_pending',
        request_id: result.request_id,
        manual_files: result.manual_files
      });

      // Notify owner/sub-owner
      this.broadcastToRole(['owner', 'sub_owner'], {
        event: 'commit_approval_needed',
        request_id: result.request_id,
        agent_id: clientInfo.agentId,
        files,
        summary: summary || '',
        manual_files: result.manual_files
      });
      return;
    }

    // Auto-approved
    this.send(ws, { event: 'commit_approved', files });
  }

  handleApproveCommit(ws, message, clientInfo) {
    if (!this.auth.canApproveCommits(clientInfo.machine)) {
      return this.send(ws, {
        event: 'error',
        message: 'Only owner or sub-owner can approve commits'
      });
    }

    const { request_id } = message;
    if (!request_id) {
      return this.send(ws, { event: 'error', message: 'request_id is required' });
    }

    const result = this.approvalEngine.approveCommit(request_id, clientInfo.agentId);
    if (!result) {
      return this.send(ws, {
        event: 'error',
        message: `No pending commit found for request_id: ${request_id}`
      });
    }

    // Notify the original requester
    this.sendTo(result.agent_id, {
      event: 'commit_approved',
      request_id,
      files: result.files
    });
  }

  handleRejectCommit(ws, message, clientInfo) {
    if (!this.auth.canApproveCommits(clientInfo.machine)) {
      return this.send(ws, {
        event: 'error',
        message: 'Only owner or sub-owner can reject commits'
      });
    }

    const { request_id, reason } = message;
    if (!request_id) {
      return this.send(ws, { event: 'error', message: 'request_id is required' });
    }

    const result = this.approvalEngine.rejectCommit(
      request_id,
      clientInfo.agentId,
      reason || 'Rejected by owner'
    );

    if (!result) {
      return this.send(ws, {
        event: 'error',
        message: `No pending commit found for request_id: ${request_id}`
      });
    }

    this.sendTo(result.agent_id, {
      event: 'commit_rejected',
      request_id,
      reason: result.reason
    });
  }

  handleNotifySync(ws, message, clientInfo) {
    const { files, message: syncMessage } = message;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return this.send(ws, { event: 'error', message: 'files[] is required' });
    }

    // Auto-release locks for committed files
    const releaseResult = this.state.releaseLock(files, clientInfo.agentId);

    this.logger.filesChanged(clientInfo.agentId, files, syncMessage);

    if (releaseResult.released.length > 0) {
      this.logger.lockReleased(clientInfo.agentId, releaseResult.released);
    }

    this.broadcast({
      event: 'files_changed',
      files,
      agent_id: clientInfo.agentId,
      message: syncMessage || 'Files updated, sync needed'
    });
  }

  handleListAgents(ws) {
    const agents = this.state.getAgents();
    this.send(ws, { event: 'agents_list', agents });
  }

  broadcastToRole(roles, message) {
    const agents = this.state.getConnectedAgents();
    for (const agent of agents) {
      if (roles.includes(agent.role)) {
        this.sendTo(agent.agent_id, message);
      }
    }
  }

  send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }
}

module.exports = Handlers;
