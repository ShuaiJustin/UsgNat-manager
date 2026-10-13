const { execFileSync } = require('node:child_process');
const path = require('node:path');

const TARGET_PATTERN = /^USG-NAT-Manager\/update-signing\/(key|backup-password|test)\/[a-zA-Z0-9_-]{16,80}$/;

function credentialOperation(operation, target, value) {
  if (!TARGET_PATTERN.test(target)) throw new Error('Invalid signing credential target');
  if (process.platform !== 'win32') throw new Error('Signing credentials require Windows');
  if (value !== undefined && (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2048)) {
    throw new Error('Invalid signing credential value');
  }
  try {
    const output = execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      path.join(__dirname, 'windows-signing-credentials.ps1'), '-Operation', operation, '-Target', target,
    ], {
      input: value === undefined ? '' : JSON.stringify({ value }),
      encoding: 'utf8', windowsHide: true, timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32768,
    });
    return JSON.parse(output);
  } catch {
    // Child-process errors may contain captured secret output. Never forward them.
    throw new Error('Signing credential operation failed');
  }
}

function readCredential(target) {
  const result = credentialOperation('read', target);
  return result.found ? Buffer.from(result.value, 'base64').toString('utf8') : null;
}

function writeNewCredential(target, value) {
  credentialOperation('write', target, value);
}

function deleteTestCredential(target) {
  if (!/^USG-NAT-Manager\/update-signing\/test\/[a-zA-Z0-9_-]{16,80}$/.test(target)) {
    throw new Error('Only a test credential can be deleted by this helper');
  }
  credentialOperation('delete-test', target);
}

function withTestCredential(target, value, action) {
  if (!/^USG-NAT-Manager\/update-signing\/test\/[a-zA-Z0-9_-]{16,80}$/.test(target)) {
    throw new Error('Only a test credential can be used by this helper');
  }
  // A failed or unknown write never establishes ownership and must not delete.
  writeNewCredential(target, value);
  try { return action(); } finally { deleteTestCredential(target); }
}

module.exports = { readCredential, writeNewCredential, deleteTestCredential, withTestCredential };
