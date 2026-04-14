const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logPath) {
    this.logPath = logPath || path.join(__dirname, 'acdp-socket-events.log');
  }

  log(event) {
    const entry = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    };
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf8');
  }

  lockAcquired(agentId, files, reason) {
    this.log({ type: 'lock_acquired', agent_id: agentId, files, reason });
  }

  lockReleased(agentId, files) {
    this.log({ type: 'lock_released', agent_id: agentId, files });
  }

  commitRequested(agentId, requestId, files, summary) {
    this.log({ type: 'commit_requested', agent_id: agentId, request_id: requestId, files, summary });
  }

  commitApproved(requestId, approvedBy) {
    this.log({ type: 'commit_approved', request_id: requestId, approved_by: approvedBy });
  }

  commitRejected(requestId, rejectedBy, reason) {
    this.log({ type: 'commit_rejected', request_id: requestId, rejected_by: rejectedBy, reason });
  }

  filesChanged(agentId, files, message) {
    this.log({ type: 'files_changed', agent_id: agentId, files, message });
  }

  agentConnected(agentId, machine) {
    this.log({ type: 'agent_connected', agent_id: agentId, machine });
  }

  agentDisconnected(agentId, machine) {
    this.log({ type: 'agent_disconnected', agent_id: agentId, machine });
  }
}

module.exports = Logger;
