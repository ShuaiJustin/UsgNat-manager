const fs = require('node:fs');
const path = require('node:path');

const distMainPath = path.resolve(__dirname, '..', '..', 'dist', 'main');

fs.rmSync(distMainPath, { recursive: true, force: true });
console.log(`[clean-main-dist] Cleared ${distMainPath}`);
