#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const lockManager = require('./lock-manager');
const coordinationBranch = require('./coordination-branch');

const ACDP_DIR = process.env.ACDP_BASE_DIR || __dirname;
const EVENTS_LOG = process.env.ACDP_EVENTS_LOG || path.join(ACDP_DIR, 'events.log');
const STATE_MD = process.env.ACDP_STATE_MD || path.join(ACDP_DIR, 'state.md');
const REPO_ROOT = coordinationBranch.getRepoRoot(ACDP_DIR);

const COLORS = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function getTimestamp() {
  return new Date().toISOString();
}

function getAgentId() {
  return process.env.ACDP_AGENT_ID || 'local-agent';
}

function getCurrentBranch() {
  if (process.env.ACDP_BRANCH) {
    return process.env.ACDP_BRANCH;
  }

  try {
    const repoRoot = path.resolve(ACDP_DIR, '..');
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim() || 'main';
  } catch (error) {
    return 'main';
  }
}

function getDefaultBranch() {
  try {
    const gov = JSON.parse(fs.readFileSync(path.join(ACDP_DIR, 'governance.json'), 'utf8'));
    return gov.default_branch || 'main';
  } catch {
    return 'main';
  }
}

function ensureEventsLogExists() {
  if (!fs.existsSync(EVENTS_LOG)) {
    fs.writeFileSync(EVENTS_LOG, '');
  }
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '');
  }
}

function appendEvent(type, data, options = {}) {
  const logPath = options.eventsLog || EVENTS_LOG;
  ensureFileExists(logPath);

  const event = {
    type,
    agent: getAgentId(),
    timestamp: getTimestamp(),
    data
  };

  fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);

  if (!options.silent) {
    console.log(`[ACDP] Logged '${type}' event.`);
  }

  return event;
}

function cleanupExpiredLocks({ logEvents = false } = {}) {
  return lockManager.cleanupExpiredLocks({
    onExpired: logEvents
      ? lock => appendEvent('release', { resource: lock.resource, expired: true })
      : undefined
  });
}

function resolveLockByIdentifier(locks, identifier, agentId) {
  const value = String(identifier || '').trim();

  if (!value) {
    throw new Error('A resource or lock_id is required.');
  }

  const directMatch = locks.find(lock => lock.lock_id === value || lock.resource === value);
  if (directMatch) {
    if (agentId && directMatch.agent_id !== agentId) {
      throw new Error(`Lock '${directMatch.resource}' is held by '${directMatch.agent_id}', not '${agentId}'.`);
    }
    return directMatch;
  }

  const normalizedMatch = locks.find(lock => {
    try {
      return lockManager.normalizeResource(value, lock.scope) === lock.resource;
    } catch (error) {
      return false;
    }
  });

  if (!normalizedMatch) {
    throw new Error(`No lock found for '${value}'.`);
  }

  if (agentId && normalizedMatch.agent_id !== agentId) {
    throw new Error(`Lock '${normalizedMatch.resource}' is held by '${normalizedMatch.agent_id}', not '${agentId}'.`);
  }

  return normalizedMatch;
}

function formatCoordinationBranchRef(snapshot) {
  const remote = snapshot && snapshot.remote ? snapshot.remote : coordinationBranch.REMOTE_NAME;
  const branch = snapshot && snapshot.branch ? snapshot.branch : coordinationBranch.COORDINATION_BRANCH;
  return `${remote}/${branch}`;
}

function getRequiredProtocolFiles() {
  return [
    'protocol.md',
    'architecture.md',
    'state.md',
    'agents.md',
    'locks.json',
    'governance.json',
    'agents.registry.json',
    'messages.schema.json',
    'events.log'
  ];
}

function validateJsonContent(label, content) {
  try {
    JSON.parse(content);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `${label}: ${error.message}` };
  }
}

function validateJsonlContent(label, content) {
  const lines = String(content || '').split(/\r?\n/).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    try {
      JSON.parse(lines[index]);
    } catch (error) {
      return { ok: false, error: `${label}: invalid JSON on line ${index + 1}` };
    }
  }

  return { ok: true };
}

function validateProtocolFiles() {
  const results = [];

  for (const relativePath of getRequiredProtocolFiles()) {
    const absolutePath = path.join(ACDP_DIR, relativePath);
    const exists = fs.existsSync(absolutePath);
    const entry = { file: relativePath, exists, ok: exists };

    if (!exists) {
      entry.ok = false;
      entry.error = 'missing';
      results.push(entry);
      continue;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');

    if (relativePath.endsWith('.json')) {
      Object.assign(entry, validateJsonContent(relativePath, content));
    } else if (relativePath === 'events.log') {
      Object.assign(entry, validateJsonlContent(relativePath, content));
    }

    results.push(entry);
  }

  return results;
}

function getCurrentBranchHealth() {
  const branch = getCurrentBranch();

  if (!branch || branch === 'HEAD') {
    return { branch, sensible: false, reason: 'Detached HEAD is not recommended for ACDP work.' };
  }

  if (branch === coordinationBranch.COORDINATION_BRANCH || branch === formatCoordinationBranchRef({})) {
    return { branch, sensible: false, reason: 'Work should happen on a feature branch, not the coordination branch.' };
  }

  if (branch === 'main' || branch === 'master') {
    return { branch, sensible: false, reason: 'A dedicated feature branch is safer than working directly on the default branch.' };
  }

  return { branch, sensible: true, reason: 'Current branch looks suitable for agent work.' };
}

function getCoordinationFileDiffs(snapshot) {
  if (!snapshot.available) {
    return [];
  }

  return coordinationBranch.DEFAULT_COORD_FILES.map(file => {
    const remoteContent = coordinationBranch.readTreeFile(REPO_ROOT, snapshot.ref, file, null);
    const localContent = coordinationBranch.getLocalFileContent(REPO_ROOT, file);
    return {
      file: `acdp/${file}`,
      differs: remoteContent !== localContent
    };
  }).filter(entry => entry.differs);
}

function getCoordinationStateSignals(snapshot) {
  if (!snapshot.available) {
    return {
      expected_branch_divergence: false,
      stale_coordination_snapshot: false,
      local_protocol_differs_from_remote: false,
      stale_snapshot_files: [],
      local_diff_files: [],
      local_stale: false
    };
  }

  const currentBranch = getCurrentBranch();
  const expectedBranchDivergence = Boolean(currentBranch)
    && currentBranch !== 'HEAD'
    && currentBranch !== coordinationBranch.COORDINATION_BRANCH
    && currentBranch !== formatCoordinationBranchRef(snapshot);

  const staleSnapshotFiles = coordinationBranch.DEFAULT_COORD_FILES.map(file => {
    const remoteContent = coordinationBranch.readTreeFile(REPO_ROOT, snapshot.ref, file, null);
    const headContent = coordinationBranch.readTreeFile(REPO_ROOT, 'HEAD', file, null);
    return {
      file: `acdp/${file}`,
      differs: remoteContent !== headContent
    };
  }).filter(entry => entry.differs);

  const localDiffFiles = getCoordinationFileDiffs(snapshot);
  const staleCoordinationSnapshot = staleSnapshotFiles.length > 0;
  const localProtocolDiffers = localDiffFiles.length > 0;

  return {
    expected_branch_divergence: expectedBranchDivergence,
    stale_coordination_snapshot: staleCoordinationSnapshot,
    local_protocol_differs_from_remote: localProtocolDiffers,
    stale_snapshot_files: staleSnapshotFiles.map(entry => entry.file),
    local_diff_files: localDiffFiles.map(entry => entry.file),
    local_stale: localProtocolDiffers
  };
}

function formatRelativeExpiry(expiresAt) {
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return 'unknown expiry';
  }

  const diffMs = expires.getTime() - Date.now();
  if (diffMs <= 0) {
    return 'expired';
  }

  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  }

  return `in ${totalMinutes}m`;
}

function describeLock(lock) {
  const metadata = [];

  if (lock.lock_id) {
    metadata.push(`lock_id=${lock.lock_id}`);
  }

  if (lock.base_coord_rev) {
    metadata.push(`base=${String(lock.base_coord_rev).slice(0, 12)}`);
  }

  const suffix = metadata.length > 0 ? ` {${metadata.join(', ')}}` : '';
  return ` - [${lock.scope}] ${lock.resource} (by ${lock.agent_id}) expires ${lock.expires_at} (${formatRelativeExpiry(lock.expires_at)})${suffix}`;
}

function describeLockHolder(lock) {
  if (!lock) {
    return 'unknown holder';
  }

  const details = [`held by '${lock.agent_id}'`, `expires ${lock.expires_at} (${formatRelativeExpiry(lock.expires_at)})`];

  if (lock.branch) {
    details.push(`branch ${lock.branch}`);
  }

  if (lock.lock_id) {
    details.push(`lock_id=${lock.lock_id}`);
  }

  return details.join(', ');
}

function findConflictingLock(locks, resource, scope, agentId) {
  const normalizedScope = lockManager.normalizeScope(resource, scope);
  const normalizedResource = lockManager.normalizeResource(resource, normalizedScope);

  return locks.find(lock => {
    if (agentId && lock.agent_id === agentId && lock.resource === normalizedResource) {
      return false;
    }

    return lockManager.locksConflict({ resource: normalizedResource, scope: normalizedScope }, lock);
  }) || null;
}

function formatRemoteStateErrors(snapshot) {
  const health = snapshot && snapshot.coordinationHealth;
  if (!health || health.ok) {
    return [];
  }

  return Array.isArray(health.errors) ? health.errors : [];
}

function buildRemoteConflictError(action, detail, snapshot) {
  const lines = [`Remote ${action} rejected: ${detail}`];

  if (snapshot && snapshot.available) {
    lines.push(`Authoritative coordination ref: ${formatCoordinationBranchRef(snapshot)} @ ${snapshot.revision}`);
  }

  lines.push('Run `node acdp/cli.js status --remote` to inspect the latest authoritative locks before retrying.');
  return new Error(lines.join(' '));
}

function createLockId() {
  return `${getAgentId()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCoordinationSnapshot() {
  return coordinationBranch.loadRemoteCoordinationSnapshot(REPO_ROOT);
}

function summarizeRemoteStatus(snapshot) {
  const locks = Array.isArray(snapshot.locksDocument && snapshot.locksDocument.locks)
    ? snapshot.locksDocument.locks
    : [];
  const activeLocks = locks.filter(lock => !lockManager.isExpired(lock));
  const expiredLocks = locks.filter(lock => lockManager.isExpired(lock));

  const signals = getCoordinationStateSignals(snapshot);

  return {
    mode: snapshot.mode,
    remote: snapshot.remote || coordinationBranch.REMOTE_NAME,
    branch: snapshot.branch || coordinationBranch.COORDINATION_BRANCH,
    available: Boolean(snapshot.available),
    base_coord_rev: snapshot.revision || null,
    expected_branch_divergence: signals.expected_branch_divergence,
    stale_coordination_snapshot: signals.stale_coordination_snapshot,
    stale_snapshot_files: signals.stale_snapshot_files,
    local_protocol_differs_from_remote: signals.local_protocol_differs_from_remote,
    local_diff_files: signals.local_diff_files,
    local_stale: signals.local_stale,
    authoritative_remote_healthy: !snapshot.available || !snapshot.coordinationHealth ? true : Boolean(snapshot.coordinationHealth.ok),
    authoritative_remote_errors: formatRemoteStateErrors(snapshot),
    active_lock_count: activeLocks.length,
    expired_lock_count: expiredLocks.length,
    active_locks: activeLocks,
    expired_locks: expiredLocks
  };
}

function lockResource(resource, scope, reason, ttlMinutes, options = {}) {
  const branch = getCurrentBranch();
  const baseBranch = getDefaultBranch();
  const task = reason || `Work on ${resource}`;
  const snapshot = getCoordinationSnapshot();

  if (!snapshot.available) {
    throw new Error(
      'Remote coordination branch (origin/acdp/state) not found.\n' +
      'Locks must be published remotely so all agents can see them.\n' +
      'Set up origin/acdp/state first. See docs/remote-operations.md for instructions.'
    );
  }

  const result = coordinationBranch.publishRemoteMutation({
    repoRoot: REPO_ROOT,
    agentId: getAgentId(),
    summary: `acdp(remote): lock ${resource}`,
    mutate: ({ acdpDir, baseCoordRev }) => {
      const locksJson = path.join(acdpDir, 'locks.json');
      const governanceJson = path.join(acdpDir, 'governance.json');
      const eventsLog = path.join(acdpDir, 'events.log');

      lockManager.cleanupExpiredLocks({ locksJson, governanceJson });
      const currentLocks = lockManager.loadLocks({ locksJson, governanceJson });
      const conflictingLock = findConflictingLock(currentLocks, resource, scope, getAgentId());
      if (conflictingLock) {
        throw buildRemoteConflictError(
          'lock',
          `resource '${lockManager.normalizeResource(resource, lockManager.normalizeScope(resource, scope))}' is ${describeLockHolder(conflictingLock)}. Wait for release/expiry, ask the holder to release, or choose another resource.`,
          snapshot
        );
      }
      const existingLock = currentLocks.find(lock => lock.resource === lockManager.normalizeResource(resource, lockManager.normalizeScope(resource, scope)));
      const lockId = existingLock && existingLock.agent_id === getAgentId() && existingLock.lock_id
        ? existingLock.lock_id
        : createLockId();

      appendEvent('intent', {
        task,
        branch,
        resources: [resource],
        base_coord_rev: baseCoordRev
      }, { eventsLog, silent: true });

      const lockResult = lockManager.acquireLock({
        resource,
        scope,
        reason: task,
        ttlMinutes,
        agentId: getAgentId(),
        branch,
        baseBranch,
        lockId,
        baseCoordRev,
        locksJson,
        governanceJson
      });

      appendEvent('lock', {
        resource: lockResult.lock.resource,
        scope: lockResult.lock.scope,
        reason: lockResult.lock.reason,
        ttl_minutes: lockResult.ttlMinutes,
        branch,
        base_branch: baseBranch,
        lock_id: lockResult.lock.lock_id,
        base_coord_rev: baseCoordRev,
        ...(lockResult.renewal ? { renewal: true } : {})
      }, { eventsLog, silent: true });

      return {
        resource: lockResult.lock.resource,
        renewal: lockResult.renewal,
        expiresAt: lockResult.lock.expires_at,
        lockId: lockResult.lock.lock_id
      };
    }
  });

  if (!result.changed) {
    console.log('[ACDP] No remote coordination changes were needed.');
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ status: result.renewal ? 'renewed' : 'locked', lock_id: result.lockId || null, resource: result.resource, ttl_minutes: result.ttlMinutes || null, base_coord_rev: result.baseCoordRev || null }));
  } else {
    console.log(
      `[ACDP] ${result.renewal ? 'Renewed' : 'Locked'} '${result.resource}' on ${coordinationBranch.REMOTE_NAME}/${coordinationBranch.COORDINATION_BRANCH} until ${result.expiresAt}.`
    );
    console.log(`[ACDP] base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
  }
}

function renewResource(identifier, ttlMinutes) {
  const branch = getCurrentBranch();
  const snapshot = getCoordinationSnapshot();

  if (!snapshot.available) {
    throw new Error(
      'Remote coordination branch (origin/acdp/state) not found.\n' +
      'Locks must be renewed remotely so all agents can see the update.\n' +
      'Set up origin/acdp/state first. See docs/remote-operations.md for instructions.'
    );
  }

  const result = coordinationBranch.publishRemoteMutation({
    repoRoot: REPO_ROOT,
    agentId: getAgentId(),
    summary: `acdp(remote): renew ${identifier}`,
    mutate: ({ acdpDir, baseCoordRev }) => {
      const locksJson = path.join(acdpDir, 'locks.json');
      const governanceJson = path.join(acdpDir, 'governance.json');
      const eventsLog = path.join(acdpDir, 'events.log');
      const currentLocks = lockManager.loadLocks({ locksJson, governanceJson });
      let existingLock;

      try {
        existingLock = resolveLockByIdentifier(currentLocks, identifier, getAgentId());
      } catch (error) {
        const resourceMatch = currentLocks.find(lock => lock.resource === identifier || lock.lock_id === identifier);
        if (resourceMatch && resourceMatch.agent_id !== getAgentId()) {
          throw buildRemoteConflictError(
            'renew',
            `lock '${resourceMatch.resource}' is ${describeLockHolder(resourceMatch)}, not '${getAgentId()}'. Ask the owner to renew/release it or wait for expiry.`,
            snapshot
          );
        }

        throw buildRemoteConflictError(
          'renew',
          `no remotely valid lock matching '${identifier}' exists for '${getAgentId()}'. It may have expired, been cleaned up, or never existed on ${coordinationBranch.COORDINATION_BRANCH}.`,
          snapshot
        );
      }

      const { clockSkewToleranceSeconds } = lockManager.getLockDefaults({ governanceJson: path.join(acdpDir, 'governance.json') });
      if (lockManager.isExpired(existingLock, new Date(), clockSkewToleranceSeconds)) {
        throw buildRemoteConflictError(
          'renew',
          `lock '${existingLock.resource}' is already expired on ${coordinationBranch.COORDINATION_BRANCH}. Reacquire it instead of renewing.`,
          snapshot
        );
      }

      const renewResult = lockManager.acquireLock({
        resource: existingLock.resource,
        scope: existingLock.scope,
        reason: existingLock.reason || `Work on ${existingLock.resource}`,
        ttlMinutes,
        agentId: getAgentId(),
        branch: existingLock.branch || branch,
        lockId: existingLock.lock_id || createLockId(),
        baseCoordRev,
        locksJson,
        governanceJson
      });

      appendEvent('lock', {
        resource: renewResult.lock.resource,
        scope: renewResult.lock.scope,
        reason: renewResult.lock.reason,
        ttl_minutes: renewResult.ttlMinutes,
        renewal: true,
        branch: renewResult.lock.branch,
        lock_id: renewResult.lock.lock_id,
        base_coord_rev: baseCoordRev
      }, { eventsLog, silent: true });

      return {
        resource: renewResult.lock.resource,
        expiresAt: renewResult.lock.expires_at,
        lockId: renewResult.lock.lock_id
      };
    }
  });

  if (!result.changed) {
    console.log('[ACDP] No remote coordination changes were needed.');
    return;
  }

  console.log(`[ACDP] Renewed '${result.resource}' on ${formatCoordinationBranchRef(snapshot)} until ${result.expiresAt}.`);
  console.log(`[ACDP] lock_id=${result.lockId} base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
}

function releaseResource(resource, summary = 'Task completed', options = {}) {
  const branch = getCurrentBranch();
  const snapshot = getCoordinationSnapshot();

  if (!snapshot.available) {
    throw new Error(
      'Remote coordination branch (origin/acdp/state) not found.\n' +
      'Locks must be released remotely so all agents can see the update.\n' +
      'Set up origin/acdp/state first. See docs/remote-operations.md for instructions.'
    );
  }

  const result = coordinationBranch.publishRemoteMutation({
    repoRoot: REPO_ROOT,
    agentId: getAgentId(),
    summary: `acdp(remote): release ${resource}`,
    mutate: ({ acdpDir, baseCoordRev }) => {
      const locksJson = path.join(acdpDir, 'locks.json');
      const governanceJson = path.join(acdpDir, 'governance.json');
      const eventsLog = path.join(acdpDir, 'events.log');
      const releaseResult = lockManager.releaseLock(resource, {
        agentId: getAgentId(),
        locksJson,
        governanceJson
      });

      if (!releaseResult.released) {
        if (releaseResult.lock) {
          throw buildRemoteConflictError(
            'release',
            `resource '${releaseResult.lock.resource}' is ${describeLockHolder(releaseResult.lock)}, not '${getAgentId()}'. Only the owner may release it normally.`,
            snapshot
          );
        }

        throw buildRemoteConflictError(
          'release',
          `no lock exists for resource '${resource}' on ${coordinationBranch.COORDINATION_BRANCH}. It may already have been released, expired, or replaced after a race.`,
          snapshot
        );
      }

      appendEvent('release', {
        resource: releaseResult.lock.resource,
        branch,
        lock_id: releaseResult.lock.lock_id,
        base_coord_rev: baseCoordRev
      }, { eventsLog, silent: true });
      appendEvent('complete', {
        task: releaseResult.lock.reason || `Work on ${releaseResult.lock.resource}`,
        branch,
        summary,
        lock_id: releaseResult.lock.lock_id,
        base_coord_rev: baseCoordRev
      }, { eventsLog, silent: true });

      return {
        resource: releaseResult.lock.resource,
        lockId: releaseResult.lock.lock_id
      };
    }
  });

  if (!result.changed) {
    console.log('[ACDP] No remote coordination changes were needed.');
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ status: 'released', resource: result.resource, lock_id: result.lockId || null }));
  } else {
    console.log(`[ACDP] Released '${result.resource}' on ${coordinationBranch.REMOTE_NAME}/${coordinationBranch.COORDINATION_BRANCH}.`);
    console.log(`[ACDP] base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
  }
}

function cleanupRemoteExpiredLocks() {
  const snapshot = getCoordinationSnapshot();

  if (!snapshot.available) {
    throw new Error(
      'Remote coordination branch (origin/acdp/state) not found.\n' +
      'Cleanup operates remotely so all agents see expired lock removal.\n' +
      'Set up origin/acdp/state first. See docs/remote-operations.md for instructions.'
    );
  }

  const result = coordinationBranch.publishRemoteMutation({
    repoRoot: REPO_ROOT,
    agentId: getAgentId(),
    summary: 'acdp(remote): cleanup expired locks',
    mutate: ({ acdpDir, baseCoordRev }) => {
      const locksJson = path.join(acdpDir, 'locks.json');
      const governanceJson = path.join(acdpDir, 'governance.json');
      const eventsLog = path.join(acdpDir, 'events.log');
      const cleanupResult = lockManager.cleanupExpiredLocks({ locksJson, governanceJson });

      cleanupResult.expired.forEach(lock => {
        appendEvent('release', {
          resource: lock.resource,
          expired: true,
          branch: lock.branch,
          lock_id: lock.lock_id,
          base_coord_rev: baseCoordRev,
          coordination_mode: 'remote-first',
          coordination_branch: formatCoordinationBranchRef(snapshot)
        }, { eventsLog, silent: true });
      });

      return {
        cleaned: cleanupResult.cleaned,
        remaining: cleanupResult.remaining,
        expiredResources: cleanupResult.expired.map(lock => lock.resource)
      };
    }
  });

  if (!result.changed) {
    console.log('[ACDP] No expired remote locks required cleanup.');
    return;
  }

  console.log(`[ACDP] Remote cleanup removed ${result.cleaned} expired lock(s) on ${formatCoordinationBranchRef(snapshot)}.`);
  console.log(`[ACDP] base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
}

function heartbeat(details = 'Agent heartbeat') {
  const snapshot = getCoordinationSnapshot();
  const branch = getCurrentBranch();

  if (!snapshot.available) {
    appendEvent('update', {
      task: 'heartbeat',
      progress: 'alive',
      details,
      heartbeat: true,
      branch,
      coordination_mode: 'legacy'
    });
    console.log('[ACDP] Logged local heartbeat event.');
    return;
  }

  const result = coordinationBranch.publishRemoteMutation({
    repoRoot: REPO_ROOT,
    agentId: getAgentId(),
    summary: 'acdp(remote): heartbeat',
    mutate: ({ acdpDir, baseCoordRev }) => {
      const eventsLog = path.join(acdpDir, 'events.log');

      appendEvent('update', {
        task: 'heartbeat',
        progress: 'alive',
        details,
        heartbeat: true,
        branch,
        base_coord_rev: baseCoordRev,
        coordination_mode: 'remote-first',
        coordination_branch: formatCoordinationBranchRef(snapshot)
      }, { eventsLog, silent: true });

      return { details };
    }
  });

  if (!result.changed) {
    console.log('[ACDP] No remote heartbeat change was required.');
    return;
  }

  console.log(`[ACDP] Logged heartbeat on ${formatCoordinationBranchRef(snapshot)}.`);
  console.log(`[ACDP] base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
}

function doctor(options = {}) {
  const snapshot = getCoordinationSnapshot();
  const branchHealth = getCurrentBranchHealth();
  const protocolFiles = validateProtocolFiles();
  const remoteSignals = getCoordinationStateSignals(snapshot);
  const locks = snapshot.available
    ? (Array.isArray(snapshot.locksDocument && snapshot.locksDocument.locks)
      ? snapshot.locksDocument.locks
      : [])
    : lockManager.loadLocks();
  const myActiveLocks = locks.filter(lock => lock.agent_id === getAgentId() && !lockManager.isExpired(lock));
  const myExpiredLocks = locks.filter(lock => lock.agent_id === getAgentId() && lockManager.isExpired(lock));
  const remoteHealthy = !snapshot.available || !snapshot.coordinationHealth ? true : Boolean(snapshot.coordinationHealth.ok);

  // Warn when any active lock will expire within the renewal threshold (default: 5 minutes).
  const renewWarningThresholdMs = 5 * 60 * 1000;
  const soonExpiringLocks = myActiveLocks.filter(lock => {
    if (!lock.expires_at) return false;
    const diffMs = new Date(lock.expires_at).getTime() - Date.now();
    return diffMs > 0 && diffMs < renewWarningThresholdMs;
  });

  const report = {
    ok: protocolFiles.every(file => file.ok) && remoteHealthy && soonExpiringLocks.length === 0,
    mode: snapshot.available ? 'remote-first' : 'legacy',
    remote: {
      available: Boolean(snapshot.available),
      ref: formatCoordinationBranchRef(snapshot),
      base_coord_rev: snapshot.revision || null,
      healthy: remoteHealthy,
      errors: formatRemoteStateErrors(snapshot),
      expected_branch_divergence: remoteSignals.expected_branch_divergence,
      stale_coordination_snapshot: remoteSignals.stale_coordination_snapshot,
      stale_snapshot_files: remoteSignals.stale_snapshot_files,
      local_protocol_differs_from_remote: remoteSignals.local_protocol_differs_from_remote,
      local_diff_files: remoteSignals.local_diff_files,
      local_stale: remoteSignals.local_stale
    },
    branch: branchHealth,
    agent: {
      id: getAgentId(),
      active_locks: myActiveLocks,
      expired_locks: myExpiredLocks,
      soon_expiring_locks: soonExpiringLocks
    },
    protocol: {
      ok: protocolFiles.every(file => file.ok),
      files: protocolFiles
    }
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }

  console.log('\n=== ACDP Doctor ===\n');
  console.log(`Mode: ${report.mode}`);
  console.log(`Coordination branch available: ${report.remote.available ? 'yes' : 'no'}`);
  console.log(`Coordination ref: ${report.remote.ref}`);
  if (report.remote.available) {
    console.log(`Remote head: ${report.remote.base_coord_rev}`);
    console.log(`Authoritative remote healthy: ${report.remote.healthy ? 'yes' : 'no'}`);
    report.remote.errors.forEach(error => console.log(` - remote error: ${error}`));
    console.log(`Expected branch divergence: ${report.remote.expected_branch_divergence ? 'yes' : 'no'} (feature branches normally differ from ${coordinationBranch.COORDINATION_BRANCH})`);
    console.log(`Stale coordination snapshot on current branch: ${report.remote.stale_coordination_snapshot ? 'yes' : 'no'}`);
    report.remote.stale_snapshot_files.forEach(file => console.log(` - stale snapshot: ${file}`));
    console.log(`Local protocol files currently differ from authoritative remote: ${report.remote.local_protocol_differs_from_remote ? 'yes' : 'no'}`);
    if (report.remote.local_diff_files.length > 0) {
      report.remote.local_diff_files.forEach(file => console.log(` - diff: ${file}`));
    }
  }
  console.log(`Current branch: ${report.branch.branch}`);
  console.log(`Branch sensible: ${report.branch.sensible ? 'yes' : 'no'} (${report.branch.reason})`);
  console.log(`Active locks held by ${report.agent.id}: ${report.agent.active_locks.length}`);
  report.agent.active_locks.forEach(lock => console.log(describeLock(lock)));
  if (report.agent.soon_expiring_locks.length > 0) {
    console.log(`\n${COLORS.yellow}[WARN] ${report.agent.soon_expiring_locks.length} lock(s) expire within 5 minutes — renew now to maintain ownership:${COLORS.reset}`);
    report.agent.soon_expiring_locks.forEach(lock => console.log(` - ${lock.resource} expires ${lock.expires_at} (${formatRelativeExpiry(lock.expires_at)})`));
  }
  if (report.agent.expired_locks.length > 0) {
    console.log(`Expired locks still associated with ${report.agent.id}: ${report.agent.expired_locks.length}`);
    report.agent.expired_locks.forEach(lock => console.log(` - [${lock.scope}] ${lock.resource} expired ${lock.expires_at}`));
  }
  console.log(`Protocol files healthy: ${report.protocol.ok ? 'yes' : 'no'}`);
  report.protocol.files.filter(file => !file.ok).forEach(file => {
    console.log(` - ${file.file}: ${file.error || 'invalid'}`);
  });

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function runBatch(task, resource, ttlMinutes, scope) {
  cleanupExpiredLocks({ logEvents: true });

  const branch = getCurrentBranch();
  appendEvent('intent', { task, branch, resources: [resource] });

  const result = lockManager.acquireLock({
    resource,
    scope,
    reason: task,
    ttlMinutes,
    agentId: getAgentId()
  });

  appendEvent('lock', {
    resource: result.lock.resource,
    scope: result.lock.scope,
    reason: result.lock.reason,
    ttl_minutes: result.ttlMinutes,
    ...(result.renewal ? { renewal: true } : {})
  });

  lockManager.releaseLock(resource, { agentId: getAgentId() });
  appendEvent('release', { resource: result.lock.resource });
  appendEvent('complete', {
    task,
    branch,
    summary: `Batch completed for ${result.lock.resource}`
  });

  console.log(`[ACDP] Batch completed for '${result.lock.resource}'.`);
}

function printStatus(options = {}) {
  if (options.remote) {
    const snapshot = getCoordinationSnapshot();
    const status = summarizeRemoteStatus(snapshot);

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log('\n=== ACDP Remote Coordination Status ===\n');
    console.log(`Mode: ${status.mode}`);
    console.log(`Branch: ${status.remote}/${status.branch}`);
    console.log(`Available: ${status.available ? 'yes' : 'no'}`);

    if (!status.available) {
      console.log('Remote coordination branch is not present. Tooling remains in legacy local mode.');
      return;
    }

    console.log(`Head Revision: ${status.base_coord_rev}`);
    console.log(`Authoritative Remote Healthy: ${status.authoritative_remote_healthy ? 'yes' : 'no'}`);
    status.authoritative_remote_errors.forEach(error => console.log(` - remote error: ${error}`));
    console.log(`Expected Branch Divergence: ${status.expected_branch_divergence ? 'yes' : 'no'}`);
    console.log(`Stale Coordination Snapshot: ${status.stale_coordination_snapshot ? 'yes' : 'no'}`);
    status.stale_snapshot_files.forEach(file => console.log(` - stale snapshot: ${file}`));
    console.log(`Local Protocol Files Differ From Remote: ${status.local_protocol_differs_from_remote ? 'yes' : 'no'}`);
    status.local_diff_files.forEach(file => console.log(` - local diff: ${file}`));
    console.log(`Active Locks: ${status.active_lock_count}`);
    status.active_locks.forEach(lock => console.log(describeLock(lock)));

    if (status.expired_lock_count > 0) {
      console.log(`\nExpired Locks Seen Remotely: ${status.expired_lock_count}`);
      status.expired_locks.forEach(lock => console.log(` - [${lock.scope}] ${lock.resource} (by ${lock.agent_id}) expired ${lock.expires_at}`));
    }

    return;
  }

  console.log('\n=== ACDP Project Status ===\n');

  const allLocks = lockManager.loadLocks();
  const activeLocks = allLocks.filter(lock => !lockManager.isExpired(lock));
  const expiredLocks = allLocks.filter(lock => lockManager.isExpired(lock));

  console.log(`Active Locks: ${activeLocks.length}`);
  activeLocks.forEach(lock => console.log(describeLock(lock)));

  if (expiredLocks.length > 0) {
    console.log(`\nExpired Locks Pending Cleanup: ${expiredLocks.length}`);
    expiredLocks.forEach(lock => console.log(` - [${lock.scope}] ${lock.resource} (by ${lock.agent_id}) expired ${lock.expires_at}`));
    console.log("Run 'node acdp/cli.js cleanup' to remove expired locks and log protocol release events.");
  }

  if (fs.existsSync(STATE_MD)) {
    const stateContent = fs.readFileSync(STATE_MD, 'utf8');
    if (stateContent.includes('status: DONE') || stateContent.includes('Status: DONE')) {
      console.log('\n⚠️ PROJECT IS MARKED AS DONE ⚠️\nNo further automated tasks should be initiated.\n');
    }
  }
}

function syncCoordination(options = {}) {
  const snapshot = getCoordinationSnapshot();
  const status = summarizeRemoteStatus(snapshot);

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (!snapshot.available) {
    console.log('[ACDP] Remote coordination branch not found. Legacy local mode remains active.');
    return;
  }

  console.log(`[ACDP] Fetched ${status.remote}/${status.branch} at ${status.base_coord_rev}.`);
  const remoteHealthSummary = status.authoritative_remote_healthy
    ? 'authoritative remote state parses cleanly'
    : `authoritative remote state unhealthy (${status.authoritative_remote_errors.join('; ')})`;
  console.log(`[ACDP] Active locks: ${status.active_lock_count}. ${remoteHealthSummary}. Expected branch divergence: ${status.expected_branch_divergence ? 'yes' : 'no'}. Stale snapshot: ${status.stale_coordination_snapshot ? 'yes' : 'no'}. Local protocol differs: ${status.local_protocol_differs_from_remote ? 'yes' : 'no'}.`);
}

function markFinished(options = {}) {
  const branch = getCurrentBranch();
  const snapshot = getCoordinationSnapshot();

  const applyDoneToStateMd = (stateDir) => {
    const stateMd = path.join(stateDir, 'state.md');
    let content = 'No state file found.';
    if (fs.existsSync(stateMd)) {
      content = fs.readFileSync(stateMd, 'utf8');
    }
    content += '\n\n**Status: DONE**\nAll project operations have officially concluded. Agents should cease task initialization and exit immediately.';
    fs.writeFileSync(stateMd, content);
  };

  if (snapshot.available && !options.offline) {
    const result = coordinationBranch.publishRemoteMutation({
      repoRoot: REPO_ROOT,
      agentId: getAgentId(),
      summary: 'acdp(remote): finish — project concluded',
      mutate: ({ acdpDir, baseCoordRev }) => {
        const eventsLog = path.join(acdpDir, 'events.log');
        applyDoneToStateMd(acdpDir);

        appendEvent('intent', {
          task: 'Owner invoked global finish',
          branch,
          resources: ['acdp/state.md'],
          base_coord_rev: baseCoordRev
        }, { eventsLog, silent: true });
        appendEvent('complete', {
          task: 'Project lifecycle completion',
          branch,
          summary: 'Project concluded gracefully via PCAD Finish.',
          base_coord_rev: baseCoordRev
        }, { eventsLog, silent: true });

        return {};
      }
    });

    if (options.json) {
      console.log(JSON.stringify({ status: 'done', coord_rev: result.resultingCoordRev || result.baseCoordRev || null }));
    } else {
      console.log('[ACDP] Project successfully marked as DONE on remote coordination branch.');
      console.log(`[ACDP] base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
    }
    return;
  }

  applyDoneToStateMd(ACDP_DIR);
  appendEvent('intent', {
    task: 'Owner invoked global finish',
    branch,
    resources: ['acdp/state.md']
  });
  appendEvent('complete', {
    task: 'Project lifecycle completion',
    branch,
    summary: 'Project concluded gracefully via PCAD Finish.'
  });

  if (options.json) {
    console.log(JSON.stringify({ status: 'done', coord_rev: null }));
  } else {
    console.log('[ACDP] Project successfully marked as DONE. Environment is finalized.');
  }
}

function overrideRelease(agentId, options = {}) {
  if (!agentId) {
    throw new Error('Usage: node acdp/cli.js override-release <agent-id>');
  }

  const callerId = getAgentId();
  const governance = JSON.parse(fs.readFileSync(path.join(ACDP_DIR, 'governance.json'), 'utf8'));

  if (!governance.maintainers || !governance.maintainers.includes(callerId)) {
    throw new Error(`Agent '${callerId}' is not a maintainer. override-release requires maintainer authority (see acdp/governance.json).`);
  }

  const snapshot = getCoordinationSnapshot();
  const branch = getCurrentBranch();

  if (snapshot.available) {
    const result = coordinationBranch.publishRemoteMutation({
      repoRoot: REPO_ROOT,
      agentId: callerId,
      summary: `acdp(remote): override-release all locks for ${agentId}`,
      mutate: ({ acdpDir, baseCoordRev }) => {
        const locksJson = path.join(acdpDir, 'locks.json');
        const governanceJson = path.join(acdpDir, 'governance.json');
        const eventsLog = path.join(acdpDir, 'events.log');
        const allLocks = lockManager.loadLocks({ locksJson, governanceJson });
        const targetLocks = allLocks.filter(lock => lock.agent_id === agentId);
        const resources = [];

        targetLocks.forEach(lock => {
          lockManager.releaseLock(lock.resource, { agentId, locksJson, governanceJson, allowForeignRelease: true });
          appendEvent('release', {
            resource: lock.resource,
            branch: lock.branch || branch,
            lock_id: lock.lock_id,
            base_coord_rev: baseCoordRev,
            override: true
          }, { eventsLog, silent: true });
          resources.push(lock.resource);
        });

        return { count: targetLocks.length, resources };
      }
    });

    if (options.json) {
      console.log(JSON.stringify({ status: 'ok', agent: agentId, locks_released: result.count || 0, resources: result.resources || [] }));
    } else {
      console.log(`[ACDP] Override-released ${result.count || 0} lock(s) for '${agentId}' on ${coordinationBranch.REMOTE_NAME}/${coordinationBranch.COORDINATION_BRANCH}.`);
    }
    return;
  }

  const allLocks = lockManager.loadLocks();
  const targetLocks = allLocks.filter(lock => lock.agent_id === agentId);
  const resources = [];

  targetLocks.forEach(lock => {
    lockManager.releaseLock(lock.resource, { agentId, allowForeignRelease: true });
    appendEvent('release', {
      resource: lock.resource,
      branch: lock.branch || branch,
      lock_id: lock.lock_id,
      override: true
    });
    resources.push(lock.resource);
  });

  if (options.json) {
    console.log(JSON.stringify({ status: 'ok', agent: agentId, locks_released: targetLocks.length, resources }));
  } else {
    console.log(`[ACDP] Override-released ${targetLocks.length} lock(s) for '${agentId}' locally.`);
  }
}

function subscribe() {
  ensureEventsLogExists();

  let lastSize = fs.statSync(EVENTS_LOG).size;

  fs.watchFile(EVENTS_LOG, { interval: 2000 }, curr => {
    if (curr.size <= lastSize) return;

    const stream = fs.createReadStream(EVENTS_LOG, { start: lastSize, end: curr.size });
    stream.on('data', chunk => {
      chunk.toString().split('\n').filter(line => line.trim().length > 0).forEach(line => {
        process.stdout.write(line + '\n');
      });
    });

    lastSize = curr.size;
  });

  process.on('SIGINT', () => {
    fs.unwatchFile(EVENTS_LOG);
    process.exit(0);
  });
}

function describeEvent(log) {
  const data = log.data || log.payload || {};
  const agent = log.agent || log.agent_id || 'unknown-agent';
  const time = new Date(log.timestamp).toLocaleTimeString();
  let color = COLORS.reset;
  let prefix = '➤';

  if (log.type === 'intent') {
    color = COLORS.blue;
    prefix = '💡';
  }
  if (log.type === 'lock') {
    color = COLORS.red;
    prefix = '🔒';
  }
  if (log.type === 'release') {
    color = COLORS.green;
    prefix = '🔓';
  }
  if (log.type === 'complete') {
    color = COLORS.yellow;
    prefix = '✅';
  }

  let details = '';
  if (data.resource) {
    details += ` [${data.resource}]`;
  }
  if (data.task) {
    details += ` - ${data.task}`;
  } else if (data.reason) {
    details += ` - ${data.reason}`;
  } else if (data.summary) {
    details += ` - ${data.summary}`;
  } else if (data.message) {
    details += ` - ${data.message}`;
  }
  if (log.type === 'lock' && Number.isInteger(data.ttl_minutes)) {
    details += ` (expires in ${data.ttl_minutes}m)`;
  }
  if (log.type === 'release' && data.expired) {
    details += ' (expired lock cleanup)';
  }

  return `${color}[${time}] ${agent} ${prefix} ${String(log.type || '').toUpperCase()}${details}${COLORS.reset}`;
}

function watchLogs() {
  console.log(`${COLORS.green}📡 ACDP Live Monitor (TUI)${COLORS.reset}`);
  console.log(`Watching for protocol events in: ${EVENTS_LOG}\n`);

  ensureEventsLogExists();

  let lastSize = fs.statSync(EVENTS_LOG).size;

  fs.watchFile(EVENTS_LOG, { interval: 500 }, curr => {
    if (curr.size <= lastSize) {
      return;
    }

    const stream = fs.createReadStream(EVENTS_LOG, { start: lastSize, end: curr.size });
    stream.on('data', chunk => {
      const lines = chunk
        .toString()
        .split('\n')
        .filter(line => line.trim().length > 0);

      lines.forEach(line => {
        try {
          console.log(describeEvent(JSON.parse(line)));
        } catch (error) {
          console.log(`${COLORS.yellow}[ACDP] Skipping malformed log line.${COLORS.reset}`);
        }
      });
    });

    lastSize = curr.size;
  });
}

function printUsage() {
  console.log(`ACDP CLI Tools — v${require('fs').existsSync(require('path').join(__dirname, '..', 'VERSION')) ? require('fs').readFileSync(require('path').join(__dirname, '..', 'VERSION'), 'utf8').trim() : '?'}

All coordination commands operate against origin/acdp/state.
Set up that branch before using lock, release, or cleanup.

Usage:
  node acdp/cli.js lock <resource> [scope] [reason] [ttlMinutes] [--json]
  node acdp/cli.js renew <resource|lock-id> [ttlMinutes]
  node acdp/cli.js release <resource> [summary] [--json]
  node acdp/cli.js cleanup
  node acdp/cli.js heartbeat [details]
  node acdp/cli.js doctor [--json]
  node acdp/cli.js status [--remote] [--json]
  node acdp/cli.js sync [--json]
  node acdp/cli.js watch
  node acdp/cli.js subscribe
  node acdp/cli.js batch <task> <resource> [ttlMinutes] [scope]
  node acdp/cli.js finish [--json] [--offline]
  node acdp/cli.js override-release <agent-id> [--json]
  node acdp/export-logs.js [output-directory]

Flags:
  --json     Output result as JSON (machine-readable; supported on lock, release, finish, override-release, doctor, status, sync)
  --offline  Read-only mode: skip remote coordination (supported on finish)
  --remote   Show remote coordination state (status command only)

Scopes:
  file | directory

Examples:
  node acdp/cli.js lock "src/app.js" file "Fix routing bug" 30
  node acdp/cli.js lock "src/app.js" --json
  node acdp/cli.js renew "src/app.js" 45
  node acdp/cli.js release "src/app.js" "Routing bug fixed" --json
  node acdp/cli.js cleanup
  node acdp/cli.js heartbeat "Still processing dashboard refactor"
  node acdp/cli.js doctor --json
  node acdp/cli.js status --remote --json
  node acdp/cli.js sync
  node acdp/cli.js finish --json
  node acdp/cli.js override-release crashed-agent --json
  node acdp/cli.js subscribe
  node acdp/cli.js batch "refresh-dashboard-cache" "src/cache/dashboard.json" 5 file
  node acdp/export-logs.js
`);
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function isScopeArg(value) {
  return value === 'file' || value === 'directory' || value === 'exclusive';
}

function parseLockArguments(args) {
  const resource = args[1];
  const second = args[2];

  if (isScopeArg(second)) {
    return {
      resource,
      scope: second,
      reason: args[3] || 'Task execution',
      ttlMinutes: args[4]
    };
  }

  return {
    resource,
    scope: undefined,
    reason: second || 'Task execution',
    ttlMinutes: args[3]
  };
}

function parseBatchArguments(args) {
  const task = args[1];
  const resource = args[2];
  const third = args[3];

  if (isScopeArg(third)) {
    return {
      task,
      resource,
      ttlMinutes: undefined,
      scope: third
    };
  }

  return {
    task,
    resource,
    ttlMinutes: third,
    scope: args[4]
  };
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'lock':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js lock <resource> [scope] [reason] [ttlMinutes]');
      }
      {
        const parsed = parseLockArguments(args);
        lockResource(parsed.resource, parsed.scope, parsed.reason, parsed.ttlMinutes, { json: hasFlag(args, '--json') });
      }
      break;
    case 'release':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js release <resource> [summary]');
      }
      releaseResource(args[1], args[2] || 'Task completed', { json: hasFlag(args, '--json') });
      break;
    case 'renew':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js renew <resource|lock-id> [ttlMinutes]');
      }
      renewResource(args[1], args[2]);
      break;
    case 'status':
      printStatus({ remote: hasFlag(args, '--remote'), json: hasFlag(args, '--json') });
      break;
    case 'doctor':
      doctor({ json: hasFlag(args, '--json') });
      break;
    case 'sync':
      syncCoordination({ json: hasFlag(args, '--json') });
      break;
    case 'watch':
      watchLogs();
      break;
    case 'cleanup':
      cleanupRemoteExpiredLocks();
      break;
    case 'heartbeat':
      heartbeat(args.slice(1).join(' ').trim() || 'Agent heartbeat');
      break;
    case 'batch':
      if (!args[1] || !args[2]) {
        throw new Error('Usage: node acdp/cli.js batch <task> <resource> [ttlMinutes] [scope]');
      }
      {
        const parsed = parseBatchArguments(args);
        runBatch(parsed.task, parsed.resource, parsed.ttlMinutes, parsed.scope);
      }
      break;
    case 'finish':
      markFinished({ json: hasFlag(args, '--json'), offline: hasFlag(args, '--offline') });
      break;
    case 'override-release':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js override-release <agent-id>');
      }
      overrideRelease(args[1], { json: hasFlag(args, '--json') });
      break;
    case 'subscribe':
      subscribe();
      break;
    default:
      printUsage();
      break;
  }
}

try {
  main();
} catch (error) {
  console.error(`[ACDP] ${error.message}`);
  process.exit(1);
}
