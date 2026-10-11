'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./harness');

const { ctx } = makeEnv();

test('normalizes messy key input the same way the website does', () => {
  assert.equal(ctx.normalizeKey('k7rm-qx4p 9wab'), 'K7RMQX4P9WAB');
  assert.equal(ctx.normalizeKey('  K7RM QX4P-9WAB \n'), 'K7RMQX4P9WAB');
  assert.equal(ctx.normalizeKey('K7RM\tQX4P9WAB'), 'K7RMQX4P9WAB');
  assert.equal(ctx.normalizeKey(null), '');
});

test('formats a key for display', () => {
  assert.equal(ctx.formatKey('K7RMQX4P9WAB'), 'K7RM-QX4P-9WAB');
});

test('generated keys: 12 chars, safe alphabet, no ambiguous characters, all distinct', () => {
  const seen = new Set();
  const counts = {};
  for (let i = 0; i < 3000; i++) {
    const k = ctx.generateKey();
    assert.match(k, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
    assert.ok(!/[01OIL]/.test(k));
    assert.equal(ctx.normalizeKey(ctx.formatKey(k)), k, 'format/normalize round-trips');
    seen.add(k);
    for (const ch of k) counts[ch] = (counts[ch] || 0) + 1;
  }
  assert.equal(seen.size, 3000, 'no collisions');
  assert.equal(Object.keys(counts).length, 31, 'every alphabet character appears');
  // roughly uniform: expected 36000/31 = 1161 each
  for (const n of Object.values(counts)) assert.ok(n > 900 && n < 1450, 'character frequency looks uniform: ' + n);
});

test('constant-time compare', () => {
  assert.equal(ctx.constantTimeEquals_('abc', 'abc'), true);
  assert.equal(ctx.constantTimeEquals_('abc', 'abd'), false);
  assert.equal(ctx.constantTimeEquals_('abc', 'abcd'), false);
  assert.equal(ctx.constantTimeEquals_('', 'x'), false);
});

test('display name normalization', () => {
  assert.equal(ctx.normalizeDisplayName_('  jane   doe '), 'Jane Doe');
  assert.equal(ctx.normalizeDisplayName_('JANE DOE'), 'Jane Doe');
  assert.equal(ctx.normalizeDisplayName_('McDonald  J'), 'McDonald J');   // mixed case is left alone
  assert.equal(ctx.normalizeDisplayName_('x'.repeat(100)).length, 60);
});
