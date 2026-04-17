const os = require('os');

class Auth {
  constructor(config, governance) {
    this.token = config.token;
    // ACDP_OWNER / ACDP_SUB_OWNER env vars override governance.json (Fix C).
    // Useful when cloning a repo whose governance hardcodes a different owner.
    this.owner = process.env.ACDP_OWNER || governance?.project?.owner || os.hostname();
    this.subOwner = process.env.ACDP_SUB_OWNER || governance?.project?.sub_owner || null;
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
