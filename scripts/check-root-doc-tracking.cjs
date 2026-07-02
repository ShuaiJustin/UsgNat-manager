#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const allowed = new Set(['README.md']);
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((file) => /^[^/\\]+\.md$/i.test(file));

const blocked = tracked.filter((file) => !allowed.has(file));
const trackedDocs = execFileSync('git', ['ls-files', 'docs/**'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

if (blocked.length || trackedDocs.length) {
  if (trackedDocs.length) {
    console.error('docs/ should not be tracked:');
    for (const file of trackedDocs) console.error(`- ${file}`);
  }

  console.error('Root Markdown files should not be tracked:');
  for (const file of blocked) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Public docs tracking OK.');
