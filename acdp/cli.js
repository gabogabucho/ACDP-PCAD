#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const lockManager = require('./lock-manager');

const ACDP_DIR = process.env.ACDP_BASE_DIR || __dirname;
const EVENTS_LOG = process.env.ACDP_EVENTS_LOG || path.join(ACDP_DIR, 'events.log');
const STATE_MD = process.env.ACDP_STATE_MD || path.join(ACDP_DIR, 'state.md');

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

function appendEvent(type, data) {
  ensureEventsLogExists();

  const event = {
    type,
    agent: getAgentId(),
    timestamp: getTimestamp(),
    data
  };

  fs.appendFileSync(EVENTS_LOG, `${JSON.stringify(event)}\n`);
  console.log(`[ACDP] Logged '${type}' event.`);
}

function cleanupExpiredLocks({ logEvents = false } = {}) {
  return lockManager.cleanupExpiredLocks({
    onExpired: logEvents
      ? lock => appendEvent('release', { resource: lock.resource, expired: true })
      : undefined
  });
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
  return ` - [${lock.scope}] ${lock.resource} (by ${lock.agent_id}) expires ${lock.expires_at} (${formatRelativeExpiry(lock.expires_at)})`;
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

function printStatus() {
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
  node acdp/cli.js release <resource> [summary]
  node acdp/cli.js status
  node acdp/cli.js watch
  node acdp/cli.js cleanup
  node acdp/cli.js batch <task> <resource> [ttlMinutes] [scope]
  node acdp/cli.js finish
  node acdp/export-logs.js [output-directory]

Scopes:
  file | directory

Examples:
  node acdp/cli.js lock "src/app.js" file "Fix routing bug" 30
  node acdp/cli.js release "src/app.js" "Routing bug fixed"
  node acdp/cli.js batch "refresh-dashboard-cache" "src/cache/dashboard.json" 5 file
  node acdp/export-logs.js
`);
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
    case 'status':
      printStatus();
      break;
    case 'watch':
      watchLogs();
      break;
    case 'cleanup': {
      const result = cleanupExpiredLocks({ logEvents: true });
      console.log(`[ACDP] Cleanup removed ${result.cleaned} expired lock(s); ${result.remaining} active lock(s) remain.`);
      break;
    }
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
