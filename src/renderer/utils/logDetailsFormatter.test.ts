import assert from 'node:assert/strict';
import test from 'node:test';

import { formatLogDetails } from './logDetailsFormatter.ts';

test('formats JSON log details and trims trailing line breaks in string fields', () => {
  const input = '{"error":"The connection is closed by SSH server\\r\\n"}';

  assert.equal(
    formatLogDetails(input),
    '{\n  "error": "The connection is closed by SSH server"\n}'
  );
});

test('normalizes plain-text log details without leaving trailing blank lines', () => {
  const input = 'read ECONNRESET\r\n';

  assert.equal(formatLogDetails(input), 'read ECONNRESET');
});
