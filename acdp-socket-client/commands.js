const AcdpSocketClient = require('./index');

class AcdpCommands {
  constructor(client) {
    if (!(client instanceof AcdpSocketClient)) {
      throw new Error('AcdpCommands requires an AcdpSocketClient instance');
    }
    this.client = client;
  }

  async lockFiles(files, reason) {
    const result = await this.client._sendWithResponse(
      'lock',
      { files, reason },
      'lock'
    );
    return result.lock;
  }

  async releaseFiles(files) {
    const result = await this.client._sendWithResponse(
      'release',
      { files },
      'release'
    );
    return result;
  }

  async checkLocks() {
    const result = await this.client._sendWithResponse(
      'check_locks',
      {},
      'check_locks'
    );
    return result.locks;
  }

  async requestCommit(files, summary) {
    // First send returns either approved, rejected, or pending
    const result = await this.client._sendWithResponse(
      'request_commit',
      { files, summary },
      'request_commit_immediate',
      10_000
    );

    if (result.event === 'commit_approved') {
      return { status: 'approved', files: result.files };
    }

    if (result.event === 'commit_rejected') {
      return { status: 'rejected', reason: result.reason };
    }

    if (result.event === 'commit_pending') {
      // Wait for the final resolution
      const resolution = await this.client._sendWithResponse(
        null, // No action to send — we're just waiting
        {},
        'request_commit',
        this.client._pendingCommitTimeout || 600_000 // 10 min default
      );
      return {
        status: resolution.event === 'commit_approved' ? 'approved' : 'rejected',
        request_id: result.request_id,
        reason: resolution.reason || null
      };
    }

    return result;
  }

  async notifySync(files, message) {
    const result = await this.client._sendWithResponse(
      'notify_sync',
      { files, message },
      'notify_sync'
    );
    return result;
  }

  async listAgents() {
    const result = await this.client._sendWithResponse(
      'list_agents',
      {},
      'list_agents'
    );
    return result.agents;
  }
}

module.exports = AcdpCommands;
