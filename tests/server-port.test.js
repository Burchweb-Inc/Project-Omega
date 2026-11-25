const assert = require('node:assert/strict');
const test = require('node:test');
const resolvePort = require('../server/port');

test('uses the positional port before PORT and defaults to 3000', () => {
  assert.equal(resolvePort('3130', '4000'), 3130);
  assert.equal(resolvePort(undefined, '4000'), 4000);
  assert.equal(resolvePort(undefined, undefined), 3000);
});

test('rejects values outside the valid TCP port range', () => {
  for (const value of ['abc', '0', '65536', '3130abc']) {
    assert.throws(() => resolvePort(value), RangeError);
  }
});
