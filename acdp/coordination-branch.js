const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REMOTE_NAME = 'origin';
const COORDINATION_BRANCH = 'acdp/state';
const COORDINATION_REF = `refs/remotes/${REMOTE_NAME}/${COORDINATION_BRANCH}`;
const DEFAULT_COORD_FILES = ['locks.json', 'events.log', 'agents.md', 'state.md', 'governance.json'];

function createHealthEntry(file, overrides = {}) {
  return {
    file,
    exists: true,
    parseable: true,
    ok: true,
    ...overrides
  };
}

function getRepoRoot(acdpDir) {
  try {
    return runGit(acdpDir, ['rev-parse', '--show-toplevel']);
  } catch (error) {
    return path.resolve(acdpDir, '..');
  }
}

function runGit(cwd, args, options = {}) {
  const result = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });

  return typeof result === 'string' ? result.trim() : '';
}

function remoteBranchExists(repoRoot) {
  try {
    const output = runGit(repoRoot, ['ls-remote', '--heads', REMOTE_NAME, COORDINATION_BRANCH]);
    return Boolean(output);
  } catch (error) {
    return false;
  }
}

function fetchCoordinationBranch(repoRoot) {
  if (!remoteBranchExists(repoRoot)) {
    return { available: false, mode: 'legacy', remote: REMOTE_NAME, branch: COORDINATION_BRANCH };
  }

  runGit(repoRoot, ['fetch', REMOTE_NAME, `refs/heads/${COORDINATION_BRANCH}:${COORDINATION_REF}`]);
  const revision = runGit(repoRoot, ['rev-parse', COORDINATION_REF]);

  return {
    available: true,
    mode: 'remote-first',
    remote: REMOTE_NAME,
    branch: COORDINATION_BRANCH,
    ref: COORDINATION_REF,
    revision
  };
}

function readTreeFile(repoRoot, ref, relativePath, fallback = null) {
  try {
    return runGit(repoRoot, ['show', `${ref}:acdp/${relativePath}`]);
  } catch (error) {
    return fallback;
  }
}

function readJsonTreeFile(repoRoot, ref, relativePath, fallback) {
  const content = readTreeFile(repoRoot, ref, relativePath, null);
  if (content === null) {
    return fallback;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function readLocalJsonFile(repoRoot, relativePath, fallback) {
  const content = getLocalFileContent(repoRoot, relativePath);
  if (content === null) {
    return fallback;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function parseEvents(content) {
  if (!content) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function inspectRemoteLocksDocument(repoRoot, ref) {
  const file = 'locks.json';
  const content = readTreeFile(repoRoot, ref, file, null);

  if (content === null) {
    return {
      document: { locks: [] },
      health: createHealthEntry(file, {
        exists: false,
        parseable: false,
        ok: false,
        error: 'missing from authoritative remote coordination branch'
      })
    };
  }

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return {
        document: { locks: parsed },
        health: createHealthEntry(file, { canonical_shape: 'legacy-array' })
      };
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.locks)) {
      return {
        document: { locks: parsed.locks },
        health: createHealthEntry(file, { canonical_shape: 'object' })
      };
    }

    return {
      document: { locks: [] },
      health: createHealthEntry(file, {
        ok: false,
        error: 'parseable JSON but not a valid lock document; expected {"locks": [...]} or a legacy array'
      })
    };
  } catch (error) {
    return {
      document: { locks: [] },
      health: createHealthEntry(file, {
        parseable: false,
        ok: false,
        error: `invalid JSON: ${error.message}`
      })
    };
  }
}

function inspectRemoteEventsLog(repoRoot, ref) {
  const file = 'events.log';
  const content = readTreeFile(repoRoot, ref, file, null);

  if (content === null) {
    return {
      events: [],
      health: createHealthEntry(file, {
        exists: false,
        parseable: false,
        ok: false,
        error: 'missing from authoritative remote coordination branch'
      })
    };
  }

  const lines = String(content).split(/\r?\n/).filter(Boolean);
  const events = [];

  for (let index = 0; index < lines.length; index += 1) {
    try {
      events.push(JSON.parse(lines[index]));
    } catch (error) {
      return {
        events: [],
        health: createHealthEntry(file, {
          parseable: false,
          ok: false,
          error: `invalid JSONL at line ${index + 1}`
        })
      };
    }
  }

  return {
    events,
    health: createHealthEntry(file)
  };
}

function getLocalFileContent(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, 'acdp', relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function loadRemoteCoordinationSnapshot(repoRoot) {
  const coordination = fetchCoordinationBranch(repoRoot);

  if (!coordination.available) {
    return {
      ...coordination,
      locksDocument: readLocalJsonFile(repoRoot, 'locks.json', { locks: [] }),
      events: parseEvents(getLocalFileContent(repoRoot, 'events.log'))
    };
  }

  const remoteLocks = inspectRemoteLocksDocument(repoRoot, coordination.ref);
  const remoteEvents = inspectRemoteEventsLog(repoRoot, coordination.ref);

  const localStaleness = DEFAULT_COORD_FILES.some(file => {
    const remoteContent = readTreeFile(repoRoot, coordination.ref, file, null);
    const localContent = getLocalFileContent(repoRoot, file);
    return remoteContent !== localContent;
  });

  return {
    ...coordination,
    locksDocument: remoteLocks.document,
    events: remoteEvents.events,
    local_stale: localStaleness,
    coordinationHealth: {
      ok: remoteLocks.health.ok && remoteEvents.health.ok,
      files: {
        'locks.json': remoteLocks.health,
        'events.log': remoteEvents.health
      },
      errors: [remoteLocks.health, remoteEvents.health]
        .filter(entry => !entry.ok)
        .map(entry => `${entry.file}: ${entry.error}`)
    }
  };
}

function createTempWorktree(repoRoot, baseRef) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acdp-state-'));

  runGit(repoRoot, ['worktree', 'add', '--detach', tempDir, baseRef]);

  return { tempDir };
}

function removeTempWorktree(repoRoot, tempDir) {
  try {
    runGit(repoRoot, ['worktree', 'remove', '--force', tempDir]);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function publishRemoteMutation(options) {
  const {
    repoRoot,
    agentId,
    summary,
    mutate,
    maxRetries = 3
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const snapshot = loadRemoteCoordinationSnapshot(repoRoot);

    if (!snapshot.available) {
      return { mode: 'legacy', available: false, retries: attempt - 1 };
    }

    if (snapshot.coordinationHealth && !snapshot.coordinationHealth.ok) {
      throw new Error(`Authoritative remote coordination state is unhealthy: ${snapshot.coordinationHealth.errors.join('; ')}`);
    }

    const baseCoordRev = snapshot.revision;
    const { tempDir } = createTempWorktree(repoRoot, baseCoordRev);

    try {
      const acdpDir = path.join(tempDir, 'acdp');
      const mutation = mutate({
        tempDir,
        acdpDir,
        baseCoordRev,
        coordination: snapshot
      }) || {};

      const changed = runGit(tempDir, ['status', '--porcelain', '--', 'acdp']);
      if (!changed) {
        return {
          mode: 'remote-first',
          available: true,
          changed: false,
          baseCoordRev,
          retries: attempt - 1,
          ...mutation
        };
      }

      runGit(tempDir, ['add', 'acdp']);
      runGit(tempDir, [
        '-c', 'user.name=ACDP CLI',
        '-c', 'user.email=acdp@example.invalid',
        'commit', '-m', `${summary} [agent:${agentId}]`
      ]);
      runGit(tempDir, ['push', REMOTE_NAME, `HEAD:refs/heads/${COORDINATION_BRANCH}`]);

      const resultingCoordRev = runGit(tempDir, ['rev-parse', 'HEAD']);
      return {
        mode: 'remote-first',
        available: true,
        changed: true,
        baseCoordRev,
        resultingCoordRev,
        retries: attempt - 1,
        ...mutation
      };
    } catch (error) {
      lastError = error;
      const stderr = String(error.stderr || '');
      const stdout = String(error.stdout || '');
      const combined = `${stderr}\n${stdout}`;

      if (!/non-fast-forward|fetch first|rejected/i.test(combined)) {
        throw new Error(combined.trim() || error.message);
      }

      if (attempt === maxRetries) {
        const latestSnapshot = loadRemoteCoordinationSnapshot(repoRoot);
        const latestRef = latestSnapshot.available ? `${REMOTE_NAME}/${COORDINATION_BRANCH} @ ${latestSnapshot.revision}` : `${REMOTE_NAME}/${COORDINATION_BRANCH}`;
        throw new Error(`Remote coordination branch kept changing while publishing '${summary}'. Refresh from ${latestRef}, inspect the current authoritative state, and retry manually if the operation still makes sense.`);
      }
    } finally {
      removeTempWorktree(repoRoot, tempDir);
    }
  }

  throw lastError || new Error('Unable to publish coordination update.');
}

module.exports = {
  REMOTE_NAME,
  COORDINATION_BRANCH,
  COORDINATION_REF,
  DEFAULT_COORD_FILES,
  getRepoRoot,
  runGit,
  readTreeFile,
  getLocalFileContent,
  fetchCoordinationBranch,
  loadRemoteCoordinationSnapshot,
  publishRemoteMutation
};
