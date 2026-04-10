#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ACDP_DIR = __dirname;
const EVENTS_LOG = path.join(ACDP_DIR, 'events.log');
const LOCKS_JSON = path.join(ACDP_DIR, 'locks.json');
const STATE_MD = path.join(ACDP_DIR, 'state.md');

function getTimestamp() {
    return new Date().toISOString();
}

function getAgentId() {
    return process.env.ACDP_AGENT_ID || 'local-agent';
}

function appendEvent(type, payload) {
    const event = {
        type,
        agent_id: getAgentId(),
        timestamp: getTimestamp(),
        payload
    };
    fs.appendFileSync(EVENTS_LOG, JSON.stringify(event) + '\n');
    console.log(`[ACDP] Event '${type}' logged successfully.`);
}

function lockResource(resource, scope = 'exclusive', description = 'Agent automated lock') {
    // 1. Declare intent
    appendEvent('intent', { description, branch: 'main' });
    
    // 2. Lock
    appendEvent('lock', { resource, scope });

    // 3. Update locks.json
    let locks = [];
    if (fs.existsSync(LOCKS_JSON)) {
        try {
            locks = JSON.parse(fs.readFileSync(LOCKS_JSON, 'utf8'));
        } catch (e) { locks = []; }
    }
    
    // Compute expiration (1 hour from now)
    const expiration = new Date();
    expiration.setHours(expiration.getHours() + 1);

    locks = locks.filter(l => l.resource !== resource);
    locks.push({
        resource,
        agent_id: getAgentId(),
        scope,
        acquired_at: getTimestamp(),
        expires_at: expiration.toISOString()
    });

    fs.writeFileSync(LOCKS_JSON, JSON.stringify(locks, null, 2));
    console.log(`[ACDP] Resource '${resource}' locked successfully.`);
}

function releaseResource(resource, description = 'Agent automated release') {
    // 1. Release event
    appendEvent('release', { resource });
    // 2. Complete event
    appendEvent('complete', { description });

    // 3. Clean locks.json
    if (fs.existsSync(LOCKS_JSON)) {
        try {
            let locks = JSON.parse(fs.readFileSync(LOCKS_JSON, 'utf8'));
            locks = locks.filter(l => l.resource !== resource);
            fs.writeFileSync(LOCKS_JSON, JSON.stringify(locks, null, 2));
        } catch (e) {}
    }
    console.log(`[ACDP] Resource '${resource}' released successfully.`);
}

function printStatus() {
    console.log(`\n=== ACDP Project Status ===\n`);
    if (fs.existsSync(LOCKS_JSON)) {
        try {
            const locks = JSON.parse(fs.readFileSync(LOCKS_JSON, 'utf8'));
            console.log(`Active Locks: ${locks.length}`);
            locks.forEach(l => console.log(` - [${l.scope}] ${l.resource} (by ${l.agent_id})`));
        } catch (e) {}
    }
    
    if (fs.existsSync(STATE_MD)) {
        const stateContent = fs.readFileSync(STATE_MD, 'utf8');
        if (stateContent.includes('status: DONE') || stateContent.includes('Status: DONE')) {
            console.log(`\n⚠️ PROJECT IS MARKED AS DONE ⚠️\nNo further automated tasks should be initiated.\n`);
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
    appendEvent('intent', { description: 'Owner invoked global finish', branch: 'main' });
    appendEvent('complete', { description: 'Project concluded gracefully via PCAD Finish.' });
    console.log(`[ACDP] Project successfully marked as DONE. Environment is finalized.`);
}

const COLORS = {
    blue: '\x1b[34m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m'
};

function watchLogs() {
    console.log(`${COLORS.green}📡 ACDP Live Monitor (TUI)${COLORS.reset}`);
    console.log(`Watching for protocol events in: ${EVENTS_LOG}\n`);
    
    let lastSize = 0;
    if (fs.existsSync(EVENTS_LOG)) {
        lastSize = fs.statSync(EVENTS_LOG).size;
    }

    fs.watchFile(EVENTS_LOG, { interval: 500 }, (curr, prev) => {
        if (curr.size > lastSize) {
            const stream = fs.createReadStream(EVENTS_LOG, { start: lastSize, end: curr.size });
            stream.on('data', chunk => {
                const lines = chunk.toString().split('\n').filter(l => l.trim().length > 0);
                lines.forEach(line => {
                    try {
                        const log = JSON.parse(line);
                        let color = COLORS.reset;
                        let prefix = '➤';
                        if (log.type === 'intent') { color = COLORS.blue; prefix = '💡'; }
                        if (log.type === 'lock') { color = COLORS.red; prefix = '🔒'; }
                        if (log.type === 'release') { color = COLORS.green; prefix = '🔓'; }
                        if (log.type === 'complete') { color = COLORS.yellow; prefix = '✅'; }

                        const time = new Date(log.timestamp).toLocaleTimeString();
                        let payloadStr = '';
                        if (log.payload.resource) payloadStr += ` [${log.payload.resource}]`;
                        if (log.payload.description) payloadStr += ` - ${log.payload.description}`;

                        console.log(`${color}[${time}] ${log.agent_id} ${prefix} ${log.type.toUpperCase()}${payloadStr}${COLORS.reset}`);
                    } catch (e) {}
                });
            });
            lastSize = curr.size;
        }
    });
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case 'lock':
        if (!args[1]) return console.error('Usage: node cli.js lock <resource> [scope] [description]');
        lockResource(args[1], args[2] || 'exclusive', args[3] || 'Task execution');
        break;
    case 'release':
        if (!args[1]) return console.error('Usage: node cli.js release <resource> [description]');
        releaseResource(args[1], args[2] || 'Task completed');
        break;
    case 'status':
        printStatus();
        break;
    case 'finish':
        markFinished();
        break;
    case 'watch':
        watchLogs();
        break;
    default:
        console.log(`ACDP CLI Tools
Usage:
  node cli.js lock <resource> [scope] [description]
  node cli.js release <resource> [description]
  node cli.js status
  node cli.js finish
  node cli.js watch

Examples:
  node cli.js lock "/src/app.js" exclusive "Fixing routing bug"
  node cli.js release "/src/app.js" "Bug thoroughly fixed"
`);
}
