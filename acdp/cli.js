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

  return {
    mode: snapshot.mode,
    remote: snapshot.remote || coordinationBranch.REMOTE_NAME,
    branch: snapshot.branch || coordinationBranch.COORDINATION_BRANCH,
    available: Boolean(snapshot.available),
    base_coord_rev: snapshot.revision || null,
    local_stale: Boolean(snapshot.local_stale),
    active_lock_count: activeLocks.length,
    expired_lock_count: expiredLocks.length,
    active_locks: activeLocks,
    expired_locks: expiredLocks
  };
}

function lockResource(resource, scope, reason, ttlMinutes) {
  cleanupExpiredLocks({ logEvents: true });

  const branch = getCurrentBranch();
  const task = reason || `Work on ${resource}`;
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

  console.log(
    `[ACDP] ${result.renewal ? 'Renewed' : 'Locked'} '${result.lock.resource}' until ${result.lock.expires_at}.`
  );
}

function lockRemoteResource(resource, scope, reason, ttlMinutes) {
  const branch = getCurrentBranch();
  const task = reason || `Work on ${resource}`;
  const snapshot = getCoordinationSnapshot();

  if (!snapshot.available) {
    console.log('[ACDP] Remote coordination branch not found; falling back to legacy local mode.');
    lockResource(resource, scope, task, ttlMinutes);
    return;
  }

  const result = coordinationBranch.publishRemoteMutation({
    repoRoot: REPO_ROOT,
    agentId: getAgentId(),
    summary: `acdp(remote): lock ${resource}`,
    mutate: ({ acdpDir, baseCoordRev }) => {
      const locksJson = path.join(acdpDir, 'locks.json');
      const governanceJson = path.join(acdpDir, 'governance.json');
      const eventsLog = path.join(acdpDir, 'events.log');

      const currentLocks = lockManager.loadLocks({ locksJson, governanceJson });
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

  console.log(
    `[ACDP] ${result.renewal ? 'Renewed' : 'Locked'} '${result.resource}' on ${coordinationBranch.REMOTE_NAME}/${coordinationBranch.COORDINATION_BRANCH} until ${result.expiresAt}.`
  );
  console.log(`[ACDP] base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
}

function renewResource(identifier, ttlMinutes) {
  const snapshot = getCoordinationSnapshot();

  if (snapshot.available) {
    renewRemoteResource(identifier, ttlMinutes, snapshot);
    return;
  }

  const existingLock = resolveLockByIdentifier(lockManager.loadLocks(), identifier, getAgentId());

  if (lockManager.isExpired(existingLock)) {
    throw new Error(`Lock '${existingLock.resource}' is expired. Reacquire it instead of renewing.`);
  }

  const renewed = lockManager.acquireLock({
    resource: existingLock.resource,
    scope: existingLock.scope,
    reason: existingLock.reason || `Work on ${existingLock.resource}`,
    ttlMinutes,
    agentId: getAgentId(),
    branch: existingLock.branch || getCurrentBranch(),
    lockId: existingLock.lock_id
  });

  appendEvent('lock', {
    resource: renewed.lock.resource,
    scope: renewed.lock.scope,
    reason: renewed.lock.reason,
    ttl_minutes: renewed.ttlMinutes,
    renewal: true,
    branch: renewed.lock.branch,
    ...(renewed.lock.lock_id ? { lock_id: renewed.lock.lock_id } : {})
  });

  console.log(`[ACDP] Renewed '${renewed.lock.resource}' locally until ${renewed.lock.expires_at}.`);
}

function renewRemoteResource(identifier, ttlMinutes, prefetchedSnapshot = null) {
  const branch = getCurrentBranch();
  const snapshot = prefetchedSnapshot || getCoordinationSnapshot();

  if (!snapshot.available) {
    console.log('[ACDP] Remote coordination branch not found; falling back to legacy local mode.');
    renewResource(identifier, ttlMinutes);
    return;
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
      const existingLock = resolveLockByIdentifier(currentLocks, identifier, getAgentId());

      if (lockManager.isExpired(existingLock)) {
        throw new Error(`Lock '${existingLock.resource}' is expired on ${coordinationBranch.COORDINATION_BRANCH}. Reacquire it instead of renewing.`);
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
        base_coord_rev: baseCoordRev,
        coordination_mode: 'remote-first',
        coordination_branch: formatCoordinationBranchRef(snapshot)
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

function releaseResource(resource, summary = 'Task completed') {
  const result = lockManager.releaseLock(resource, { agentId: getAgentId() });

  if (!result.released) {
    if (result.lock) {
      throw new Error(`Resource '${result.lock.resource}' is locked by '${result.lock.agent_id}', not '${getAgentId()}'.`);
    }

    throw new Error(`No lock found for resource '${resource}'.`);
  }

  appendEvent('release', { resource: result.lock.resource });
  appendEvent('complete', {
    task: result.lock.reason || `Work on ${result.lock.resource}`,
    branch: getCurrentBranch(),
    summary
  });

  console.log(`[ACDP] Released '${result.lock.resource}'.`);
}

function releaseRemoteResource(resource, summary = 'Task completed') {
  const branch = getCurrentBranch();
  const snapshot = getCoordinationSnapshot();

  if (!snapshot.available) {
    console.log('[ACDP] Remote coordination branch not found; falling back to legacy local mode.');
    releaseResource(resource, summary);
    return;
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
          throw new Error(`Resource '${releaseResult.lock.resource}' is locked by '${releaseResult.lock.agent_id}', not '${getAgentId()}'.`);
        }

        throw new Error(`No lock found for resource '${resource}' on ${coordinationBranch.COORDINATION_BRANCH}.`);
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

  console.log(`[ACDP] Released '${result.resource}' on ${coordinationBranch.REMOTE_NAME}/${coordinationBranch.COORDINATION_BRANCH}.`);
  console.log(`[ACDP] base_coord_rev=${String(result.baseCoordRev).slice(0, 12)} resulting_coord_rev=${String(result.resultingCoordRev).slice(0, 12)} retries=${result.retries}`);
}

function cleanupRemoteExpiredLocks() {
  const snapshot = getCoordinationSnapshot();

  if (!snapshot.available) {
    console.log('[ACDP] Remote coordination branch not found; falling back to legacy local cleanup.');
    const legacyResult = cleanupExpiredLocks({ logEvents: true });
    console.log(`[ACDP] Cleanup removed ${legacyResult.cleaned} expired lock(s); ${legacyResult.remaining} active lock(s) remain.`);
    return;
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
  const locks = snapshot.available
    ? (Array.isArray(snapshot.locksDocument && snapshot.locksDocument.locks)
      ? snapshot.locksDocument.locks
      : [])
    : lockManager.loadLocks();
  const myActiveLocks = locks.filter(lock => lock.agent_id === getAgentId() && !lockManager.isExpired(lock));
  const myExpiredLocks = locks.filter(lock => lock.agent_id === getAgentId() && lockManager.isExpired(lock));
  const diffFiles = getCoordinationFileDiffs(snapshot);

  const report = {
    mode: snapshot.available ? 'remote-first' : 'legacy',
    remote: {
      available: Boolean(snapshot.available),
      ref: formatCoordinationBranchRef(snapshot),
      base_coord_rev: snapshot.revision || null,
      local_stale: Boolean(snapshot.local_stale),
      local_diff_files: diffFiles.map(entry => entry.file)
    },
    branch: branchHealth,
    agent: {
      id: getAgentId(),
      active_locks: myActiveLocks,
      expired_locks: myExpiredLocks
    },
    protocol: {
      ok: protocolFiles.every(file => file.ok),
      files: protocolFiles
    }
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('\n=== ACDP Doctor ===\n');
  console.log(`Mode: ${report.mode}`);
  console.log(`Coordination branch available: ${report.remote.available ? 'yes' : 'no'}`);
  console.log(`Coordination ref: ${report.remote.ref}`);
  if (report.remote.available) {
    console.log(`Remote head: ${report.remote.base_coord_rev}`);
    console.log(`Local ACDP differs from remote: ${report.remote.local_stale ? 'yes' : 'no'}`);
    if (report.remote.local_diff_files.length > 0) {
      report.remote.local_diff_files.forEach(file => console.log(` - diff: ${file}`));
    }
  }
  console.log(`Current branch: ${report.branch.branch}`);
  console.log(`Branch sensible: ${report.branch.sensible ? 'yes' : 'no'} (${report.branch.reason})`);
  console.log(`Active locks held by ${report.agent.id}: ${report.agent.active_locks.length}`);
  report.agent.active_locks.forEach(lock => console.log(describeLock(lock)));
  if (report.agent.expired_locks.length > 0) {
    console.log(`Expired locks still associated with ${report.agent.id}: ${report.agent.expired_locks.length}`);
    report.agent.expired_locks.forEach(lock => console.log(` - [${lock.scope}] ${lock.resource} expired ${lock.expires_at}`));
  }
  console.log(`Protocol files healthy: ${report.protocol.ok ? 'yes' : 'no'}`);
  report.protocol.files.filter(file => !file.ok).forEach(file => {
    console.log(` - ${file.file}: ${file.error || 'invalid'}`);
  });
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
    console.log(`Local ACDP files stale vs remote: ${status.local_stale ? 'yes' : 'no'}`);
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
  console.log(`[ACDP] Active locks: ${status.active_lock_count}. Local ACDP files stale vs remote: ${status.local_stale ? 'yes' : 'no'}.`);
}

function markFinished() {
  let content = 'No state file found.';
  if (fs.existsSync(STATE_MD)) {
    content = fs.readFileSync(STATE_MD, 'utf8');
  }

  content += '\n\n**Status: DONE**\nAll project operations have officially concluded. Agents should cease task initialization and exit immediately.';
  fs.writeFileSync(STATE_MD, content);

  appendEvent('intent', {
    task: 'Owner invoked global finish',
    branch: getCurrentBranch(),
    resources: ['acdp/state.md']
  });
  appendEvent('complete', {
    task: 'Project lifecycle completion',
    branch: getCurrentBranch(),
    summary: 'Project concluded gracefully via PCAD Finish.'
  });

  console.log('[ACDP] Project successfully marked as DONE. Environment is finalized.');
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
  console.log(`ACDP CLI Tools
Usage:
  node acdp/cli.js lock <resource> [scope] [reason] [ttlMinutes]
  node acdp/cli.js renew <resource|lock-id> [ttlMinutes]
  node acdp/cli.js release <resource> [summary]
  node acdp/cli.js lock-remote <resource> [scope] [reason] [ttlMinutes]
  node acdp/cli.js release-remote <resource> [summary]
  node acdp/cli.js cleanup-remote
  node acdp/cli.js heartbeat [details]
  node acdp/cli.js doctor [--json]
  node acdp/cli.js status [--remote] [--json]
  node acdp/cli.js sync [--json]
  node acdp/cli.js watch
  node acdp/cli.js cleanup
  node acdp/cli.js batch <task> <resource> [ttlMinutes] [scope]
  node acdp/cli.js finish
  node acdp/export-logs.js [output-directory]

Scopes:
  file | directory

Examples:
  node acdp/cli.js lock "src/app.js" file "Fix routing bug" 30
  node acdp/cli.js renew "src/app.js" 45
  node acdp/cli.js lock-remote "src/app.js" file "Fix routing bug" 30
  node acdp/cli.js cleanup-remote
  node acdp/cli.js heartbeat "Still processing dashboard refactor"
  node acdp/cli.js doctor --json
  node acdp/cli.js release "src/app.js" "Routing bug fixed"
  node acdp/cli.js release-remote "src/app.js" "Routing bug fixed"
  node acdp/cli.js status --remote --json
  node acdp/cli.js sync
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
        lockResource(parsed.resource, parsed.scope, parsed.reason, parsed.ttlMinutes);
      }
      break;
    case 'release':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js release <resource> [summary]');
      }
      releaseResource(args[1], args[2] || 'Task completed');
      break;
    case 'renew':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js renew <resource|lock-id> [ttlMinutes]');
      }
      renewResource(args[1], args[2]);
      break;
    case 'lock-remote':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js lock-remote <resource> [scope] [reason] [ttlMinutes]');
      }
      {
        const parsed = parseLockArguments(args);
        lockRemoteResource(parsed.resource, parsed.scope, parsed.reason, parsed.ttlMinutes);
      }
      break;
    case 'release-remote':
      if (!args[1]) {
        throw new Error('Usage: node acdp/cli.js release-remote <resource> [summary]');
      }
      releaseRemoteResource(args[1], args[2] || 'Task completed');
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
    case 'cleanup': {
      const result = cleanupExpiredLocks({ logEvents: true });
      console.log(`[ACDP] Cleanup removed ${result.cleaned} expired lock(s); ${result.remaining} active lock(s) remain.`);
      break;
    }
    case 'cleanup-remote':
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
      markFinished();
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
