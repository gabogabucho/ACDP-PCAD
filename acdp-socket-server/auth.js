const os = require('os');

class Auth {
  constructor(config, governance) {
    this.token = config.token;
    this.owner = governance?.project?.owner || os.hostname();
    this.subOwner = governance?.project?.sub_owner || null;
  }

  validateToken(token) {
    return token === this.token;
  }

  getRole(machine) {
    if (machine === this.owner) return 'owner';
    if (machine === this.subOwner) return 'sub_owner';
    return 'agent';
  }

  isOwnerOrSubOwner(machine) {
    return machine === this.owner || machine === this.subOwner;
  }

  canApproveCommits(machine) {
    return this.isOwnerOrSubOwner(machine);
  }
}

module.exports = Auth;
