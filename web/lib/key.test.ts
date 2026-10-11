import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKey, formatKeyInput, normalizeKey } from './key.ts';

test('normalizes messy input exactly like Apps Script does', () => {
  assert.equal(normalizeKey('k7rm-qx4p 9wab'), 'K7RMQX4P9WAB');
  assert.equal(normalizeKey('  K7RM QX4P-9WAB \n'), 'K7RMQX4P9WAB');
  assert.equal(normalizeKey('K7RM\tQX4P9WAB'), 'K7RMQX4P9WAB');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
});

test('formats keys as XXXX-XXXX-XXXX', () => {
  assert.equal(formatKey('K7RMQX4P9WAB'), 'K7RM-QX4P-9WAB');
});

test('input formatting while typing / pasting', () => {
  assert.equal(formatKeyInput('k7r'), 'K7R');
  assert.equal(formatKeyInput('k7rm'), 'K7RM');
  assert.equal(formatKeyInput('k7rmq'), 'K7RM-Q');
  assert.equal(formatKeyInput('k7rm-qx4p 9wab'), 'K7RM-QX4P-9WAB');
  assert.equal(formatKeyInput('k7rm-qx4p-9wab-extra'), 'K7RM-QX4P-9WAB');   // capped at 12 characters
  assert.equal(formatKeyInput('K7RM-'), 'K7RM');                            // backspacing over a dash works
  assert.equal(formatKeyInput(''), '');
});

test('round trip: what the login form shows normalizes back to the password', () => {
  assert.equal(normalizeKey(formatKeyInput('k7rm qx4p 9wab')), 'K7RMQX4P9WAB');
});
