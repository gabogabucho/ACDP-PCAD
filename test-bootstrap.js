#!/usr/bin/env node
/**
 * Test: bootstrap auto-starts server + client connects
 */
const path = require('path');
const fs = require('fs');
const { ensureServer, tryConnect } = require('./acdp-socket-server/bootstrap');
const AcdpSocketClient = require('./acdp-socket-client');
const AcdpCommands = require('./acdp-socket-client/commands');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// Remove config so bootstrap generates one fresh
const configPath = path.join(__dirname, 'acdp-socket-server', 'config.json');
const configBackup = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null;

async function run() {
  console.log('\n=== Bootstrap E2E Test ===\n');

  // 1. Remove existing config to test auto-generation
  console.log('1. Auto-generate config');
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

  // 2. Bootstrap — should create config + start server
  console.log('\n2. Bootstrap (no server running)');
  const result = await ensureServer();
  assert(result.started === true, 'Server was auto-started');
  assert(result.config.token.length > 0, 'Token was auto-generated');
  assert(result.config.owner === require('os').hostname(), `Owner is this machine (${result.config.owner})`);
  assert(fs.existsSync(configPath), 'config.json was created');
  console.log(`   Token: ${result.config.token}`);
  console.log(`   URL: ${result.url}`);

  // 3. Bootstrap again — should find existing server
  console.log('\n3. Bootstrap again (server already running)');
  const result2 = await ensureServer();
  assert(result2.started === false, 'Server was already running, not started again');

  // 4. Connect a client
  console.log('\n4. Client connects to auto-started server');
  const client = new AcdpSocketClient({
    url: result.url,
    token: result.config.token,
    agentId: 'bootstrap-test-agent',
    machine: 'test-machine'
  });
  const state = await client.connect();
  assert(state.event === 'state_sync', 'Client received state_sync');

  const cmds = new AcdpCommands(client);
  const lock = await cmds.lockFiles(['test.js'], 'Bootstrap test');
  assert(lock.files.includes('test.js'), 'Lock acquired on auto-started server');

  await cmds.releaseFiles(['test.js']);
  const locks = await cmds.checkLocks();
  assert(locks.length === 0, 'Lock released');

  client.disconnect();

  // Cleanup: kill the auto-started server
  if (result.pid) {
    try { process.kill(result.pid); } catch {}
  }
  // Wait a beat for the process to die
  await new Promise(r => setTimeout(r, 500));

  // Restore original config
  if (configBackup) {
    fs.writeFileSync(configPath, configBackup);
  }
  // Clean up event log
  try { fs.unlinkSync(path.join(__dirname, 'acdp-socket-server', 'acdp-socket-events.log')); } catch {}

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('Test error:', err);
  if (configBackup) fs.writeFileSync(configPath, configBackup);
  process.exit(1);
});
