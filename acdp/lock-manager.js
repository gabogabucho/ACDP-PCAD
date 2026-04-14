const fs = require('fs');
const path = require('path');

const ACDP_DIR = process.env.ACDP_BASE_DIR || __dirname;
const LOCKS_JSON = process.env.ACDP_LOCKS_JSON || path.join(ACDP_DIR, 'locks.json');
const GOVERNANCE_JSON = process.env.ACDP_GOVERNANCE_JSON || path.join(ACDP_DIR, 'governance.json');

function resolvePaths(options = {}) {
  return {
    locksJson: options.locksJson || LOCKS_JSON,
    governanceJson: options.governanceJson || GOVERNANCE_JSON
  };
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function getGovernance(options = {}) {
  const paths = resolvePaths(options);
  return readJson(paths.governanceJson, {});
}

function getLockDefaults(options = {}) {
  const defaults = getGovernance(options).lock_defaults || {};

  return {
    ttlMinutes: Number.isInteger(defaults.ttl_minutes) ? defaults.ttl_minutes : 15,
    maxTtlMinutes: Number.isInteger(defaults.max_ttl_minutes) ? defaults.max_ttl_minutes : 60,
    maxLocksPerAgent: Number.isInteger(defaults.max_locks_per_agent) ? defaults.max_locks_per_agent : 3,
    clockSkewToleranceSeconds: Number.isInteger(defaults.clock_skew_tolerance_seconds)
      ? defaults.clock_skew_tolerance_seconds
      : 30
  };
}

function normalizeLocksDocument(raw) {
  if (Array.isArray(raw)) {
    return { locks: raw };
  }

  if (raw && typeof raw === 'object' && Array.isArray(raw.locks)) {
    return { locks: raw.locks };
  }

  return { locks: [] };
}

function loadLocksDocument(options = {}) {
  const paths = resolvePaths(options);
  return normalizeLocksDocument(readJson(paths.locksJson, { locks: [] }));
}

function saveLocksDocument(document, options = {}) {
  const normalized = normalizeLocksDocument(document);
  const paths = resolvePaths(options);
  fs.writeFileSync(paths.locksJson, `${JSON.stringify(normalized, null, 2)}\n`);
}

function inferScope(resource) {
  if (resource.endsWith('/')) {
    return 'directory';
  }

  return path.extname(resource) ? 'file' : 'directory';
}

function normalizeScope(resource, scope) {
  if (!scope || scope === 'exclusive') {
    return inferScope(resource);
  }

  if (scope !== 'file' && scope !== 'directory') {
    throw new Error(`Invalid lock scope '${scope}'. Use 'file' or 'directory'.`);
  }

  return scope;
}

function normalizeResource(resource, scope) {
  let value = String(resource || '').trim().replace(/\\/g, '/');

  if (!value) {
    throw new Error('Resource is required.');
  }

  value = value.replace(/^\.\//, '');

  if (scope === 'directory') {
    return value.endsWith('/') ? value : `${value}/`;
  }

  return value.endsWith('/') ? value.slice(0, -1) : value;
}

// toleranceSeconds: grace period to absorb clock skew between machines.
// A lock is considered expired only if it expired more than toleranceSeconds ago.
// Default comes from governance.json → lock_defaults.clock_skew_tolerance_seconds (default: 30).
function isExpired(lock, now = new Date(), toleranceSeconds = 0) {
  if (!lock || !lock.expires_at) {
    return false;
  }

  const expiresAt = new Date(lock.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }

  // Shift the comparison point back by the tolerance so we only declare expiry
  // after the full tolerance window has passed, regardless of local clock drift.
  const adjustedNow = new Date(now.getTime() - toleranceSeconds * 1000);
  return expiresAt <= adjustedNow;
}

function normalizeExistingLock(lock) {
  const scope = normalizeScope(lock.resource || '', lock.scope);

  return {
    ...lock,
    scope,
    resource: normalizeResource(lock.resource, scope)
  };
}

function isWithinDirectory(resource, directory) {
  const normalizedResource = resource.replace(/\\/g, '/');
  const normalizedDirectory = directory.endsWith('/') ? directory : `${directory}/`;
  return normalizedResource.startsWith(normalizedDirectory);
}

function locksConflict(lockA, lockB) {
  if (lockA.resource === lockB.resource) {
    return true;
  }

  if (lockA.scope === 'directory' && isWithinDirectory(lockB.resource, lockA.resource)) {
    return true;
  }

  if (lockB.scope === 'directory' && isWithinDirectory(lockA.resource, lockB.resource)) {
    return true;
  }

  return false;
}

function resolveTtlMinutes(ttlMinutes) {
  const defaults = getLockDefaults();

  if (ttlMinutes === undefined || ttlMinutes === null || ttlMinutes === '') {
    return defaults.ttlMinutes;
  }

  const parsed = Number(ttlMinutes);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('TTL must be a positive integer number of minutes.');
  }

  if (parsed > defaults.maxTtlMinutes) {
    throw new Error(`TTL exceeds max_ttl_minutes (${defaults.maxTtlMinutes}).`);
  }

  return parsed;
}

function loadLocks(options = {}) {
  return loadLocksDocument(options).locks.map(normalizeExistingLock);
}

function cleanupExpiredLocks(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const { clockSkewToleranceSeconds } = getLockDefaults(options);
  const document = loadLocksDocument(options);
  const activeLocks = [];
  const expiredLocks = [];

  for (const lock of document.locks.map(normalizeExistingLock)) {
    if (isExpired(lock, now, clockSkewToleranceSeconds)) {
      expiredLocks.push(lock);
    } else {
      activeLocks.push(lock);
    }
  }

  if (expiredLocks.length > 0) {
    saveLocksDocument({ locks: activeLocks }, options);
  }

  if (typeof options.onExpired === 'function') {
    expiredLocks.forEach(lock => options.onExpired(lock));
  }

  return {
    cleaned: expiredLocks.length,
    remaining: activeLocks.length,
    expired: expiredLocks,
    locks: activeLocks
  };
}

function acquireLock(options) {
  const { resource, agentId, reason } = options;

  if (!agentId) {
    throw new Error('agentId is required.');
  }

  if (!reason) {
    throw new Error('reason is required.');
  }

  cleanupExpiredLocks({ ...options, onExpired: options.onExpired });

  const defaults = getLockDefaults(options);
  const ttlMinutes = resolveTtlMinutes(options.ttlMinutes);
  const scope = normalizeScope(resource, options.scope);
  const normalizedResource = normalizeResource(resource, scope);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();

  const document = loadLocksDocument(options);
  const locks = document.locks.map(normalizeExistingLock);
  const existingIndex = locks.findIndex(lock => lock.resource === normalizedResource);
  const existingLock = existingIndex >= 0 ? locks[existingIndex] : null;
  const renewal = Boolean(existingLock && existingLock.agent_id === agentId);

  if (!renewal) {
    const locksByAgent = locks.filter(lock => lock.agent_id === agentId).length;
    if (locksByAgent >= defaults.maxLocksPerAgent) {
      throw new Error(`Agent '${agentId}' already holds the maximum number of locks (${defaults.maxLocksPerAgent}).`);
    }
  }

  const conflictingLock = locks.find(lock => {
    if (lock.agent_id === agentId && renewal && lock.resource === normalizedResource) {
      return false;
    }

    return locksConflict(
      { resource: normalizedResource, scope },
      lock
    );
  });

  if (conflictingLock) {
    throw new Error(`Resource '${normalizedResource}' is already locked by '${conflictingLock.agent_id}'.`);
  }

  const nextLock = {
    resource: normalizedResource,
    agent_id: agentId,
    scope,
    acquired_at: renewal ? existingLock.acquired_at : now.toISOString(),
    expires_at: expiresAt,
    reason
  };

  if (renewal && existingLock.lock_id) {
    nextLock.lock_id = existingLock.lock_id;
  } else if (options.lockId) {
    nextLock.lock_id = options.lockId;
  }

  if (options.baseCoordRev) {
    nextLock.base_coord_rev = options.baseCoordRev;
  }

  if (options.branch) {
    nextLock.branch = options.branch;
  }

  if (options.baseBranch) {
    nextLock.base_branch = options.baseBranch;
  }

  if (renewal) {
    locks[existingIndex] = nextLock;
  } else {
    locks.push(nextLock);
  }

  saveLocksDocument({ locks }, options);

  return {
    lock: nextLock,
    ttlMinutes,
    renewal
  };
}

function releaseLock(resource, options = {}) {
  const document = loadLocksDocument(options);
  const locks = document.locks.map(normalizeExistingLock);
  const matchingIndex = locks.findIndex(lock => {
    const normalizedResource = normalizeResource(resource, normalizeScope(resource, lock.scope));
    return lock.resource === normalizedResource;
  });

  if (matchingIndex === -1) {
    return { released: false, lock: null };
  }

  const lock = locks[matchingIndex];

  if (options.agentId && lock.agent_id !== options.agentId && !options.allowForeignRelease) {
    return { released: false, lock };
  }

  locks.splice(matchingIndex, 1);
  saveLocksDocument({ locks }, options);

  return { released: true, lock };
}

module.exports = {
  LOCKS_JSON,
  cleanupExpiredLocks,
  acquireLock,
  releaseLock,
  loadLocks,
  loadLocksDocument,
  saveLocksDocument,
  getLockDefaults,
  inferScope,
  normalizeScope,
  normalizeResource,
  isExpired,
  locksConflict,
  isWithinDirectory
};
