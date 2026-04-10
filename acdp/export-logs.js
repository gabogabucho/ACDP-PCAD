#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ACDP_DIR = process.env.ACDP_BASE_DIR || __dirname;
const EVENTS_LOG = process.env.ACDP_EVENTS_LOG || path.join(ACDP_DIR, 'events.log');
const DEFAULT_EXPORT_DIR = process.env.ACDP_EXPORT_DIR || path.join(ACDP_DIR, 'log-exports');

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function exportLogs(outputDirectory = DEFAULT_EXPORT_DIR) {
  if (!fs.existsSync(EVENTS_LOG)) {
    throw new Error(`events.log not found at ${EVENTS_LOG}`);
  }

  ensureDirectory(outputDirectory);

  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  const outputPath = path.join(outputDirectory, `events-${timestamp}.jsonl.gz`);

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(EVENTS_LOG);
    const gzip = zlib.createGzip();
    const writeStream = fs.createWriteStream(outputPath);

    readStream.on('error', reject);
    gzip.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', () => resolve(outputPath));

    readStream.pipe(gzip).pipe(writeStream);
  });
}

async function main() {
  const outputDirectory = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_EXPORT_DIR;
  const outputPath = await exportLogs(outputDirectory);
  console.log(`[ACDP] Logs exported to ${outputPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[ACDP] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { exportLogs };
