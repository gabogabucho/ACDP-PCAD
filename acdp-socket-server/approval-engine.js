const { minimatch } = require('minimatch');
const { v4: uuidv4 } = require('uuid');

class ApprovalEngine {
  constructor(config, state, logger) {
    this.manualApprovalPaths = config.manual_approval_paths || [];
    this.pendingTimeoutMinutes = config.pending_commit_timeout_minutes || 10;
    this.state = state;
    this.logger = logger;
    this._timeoutInterval = null;
  }

  requiresManualApproval(files) {
    if (this.manualApprovalPaths.length === 0) return [];

    const manualFiles = [];
    for (const file of files) {
      for (const pattern of this.manualApprovalPaths) {
        if (minimatch(file, pattern)) {
          manualFiles.push(file);
          break;
        }
      }
    }
    return manualFiles;
  }

  evaluateCommitRequest(agentId, files, summary) {
    // Check the agent holds locks for all requested files
    const locks = this.state.getLocks();
    const unlockedFiles = [];

    for (const file of files) {
      const hasLock = locks.some(
        l => l.agent_id === agentId && l.files.includes(file)
      );
      if (!hasLock) unlockedFiles.push(file);
    }

    if (unlockedFiles.length > 0) {
      return {
        status: 'rejected',
        reason: `Agent does not hold locks for: ${unlockedFiles.join(', ')}`
      };
    }

    // Check if any files require manual approval
    const manualFiles = this.requiresManualApproval(files);
    if (manualFiles.length > 0) {
      const requestId = uuidv4();
      this.state.addPendingCommit(requestId, agentId, files, summary);
      this.logger.commitRequested(agentId, requestId, files, summary);
      return {
        status: 'pending',
        request_id: requestId,
        manual_files: manualFiles
      };
    }

    // Auto-approve
    return { status: 'approved' };
  }

  approveCommit(requestId, approvedBy) {
    const result = this.state.resolvePendingCommit(requestId, true);
    if (result) {
      this.logger.commitApproved(requestId, approvedBy);
    }
    return result;
  }

  rejectCommit(requestId, rejectedBy, reason) {
    const result = this.state.resolvePendingCommit(requestId, false, reason);
    if (result) {
      this.logger.commitRejected(requestId, rejectedBy, reason);
    }
    return result;
  }

  startTimeoutChecker(onTimeout) {
    this._timeoutInterval = setInterval(() => {
      const expired = this.state.cleanupExpiredPendingCommits(this.pendingTimeoutMinutes);
      for (const p of expired) {
        this.logger.commitRejected(p.request_id, 'system', 'Approval timeout');
        if (onTimeout) onTimeout(p);
      }
    }, 30_000);
  }

  stop() {
    if (this._timeoutInterval) {
      clearInterval(this._timeoutInterval);
      this._timeoutInterval = null;
    }
  }
}

module.exports = ApprovalEngine;
