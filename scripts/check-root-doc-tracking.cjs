#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const allowed = new Set(['README.md']);
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((file) => /^[^/\\]+\.md$/i.test(file));

const blocked = tracked.filter((file) => !allowed.has(file));

if (blocked.length) {
  console.error('Root Markdown files should not be tracked:');
  for (const file of blocked) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Root Markdown tracking OK.');
