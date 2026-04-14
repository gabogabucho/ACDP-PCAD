class Auth {
  constructor(config) {
    this.token = config.token;
    this.owner = config.owner;
    this.subOwner = config.sub_owner || null;
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
