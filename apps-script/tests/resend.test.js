'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./harness');

const post = (e, body) => e.ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent();

test('doPost rejects a missing or wrong secret and changes nothing', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  const old = e.lastKey();
  assert.equal(post(e, { email: 'jane@example.com' }), 'forbidden');
  assert.equal(post(e, { secret: 'nope', email: 'jane@example.com' }), 'forbidden');
  assert.equal(post(e, { secret: 'shared-secret-value-x', email: 'jane@example.com' }), 'forbidden');
  assert.equal(post(e, 'not json'), 'bad request');
  assert.equal(e.sent.length, 1);
  assert.ok(e.sb.login('jane@example.com', old));
});

test('doPost with the secret rotates the key and emails the member', () => {
  const e = makeEnv();
  const row = e.submit({ email: 'jane@example.com' });
  const old = e.lastKey();
  assert.equal(post(e, { secret: 'shared-secret-value', email: ' JANE@example.com ' }), 'ok');
  assert.equal(e.sent.length, 2);
  assert.equal(e.sb.login('jane@example.com', old), false);
  assert.ok(e.sb.login('jane@example.com', e.lastKey()));
  assert.equal(e.sb.members[0].key_version, 2);
  assert.equal(e.sheet.val(row, 'Key version'), 2, 'Sheet bookkeeping updated');
});

test('doPost reveals nothing about unknown or deactivated emails', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  const old = e.lastKey();
  assert.equal(post(e, { secret: 'shared-secret-value', email: 'nobody@example.com' }), 'ok');
  e.sb.members[0].active = false;
  assert.equal(post(e, { secret: 'shared-secret-value', email: 'jane@example.com' }), 'ok');
  assert.equal(e.sent.length, 1, 'nothing sent');
  assert.ok(e.sb.login('jane@example.com', old), 'key untouched');
});

test('doPost still works after the contest closed (members can always get a new key)', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  e.sb.status = 'closed';
  assert.equal(post(e, { secret: 'shared-secret-value', email: 'jane@example.com' }), 'ok');
  assert.equal(e.sent.length, 2);
});

test('doPost: if the Sheet is unavailable the key is still emailed', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  e.props.RESPONSES_SHEET = 'Missing tab';
  assert.equal(post(e, { secret: 'shared-secret-value', email: 'jane@example.com' }), 'ok');
  assert.equal(e.sent.length, 2);
  assert.ok(e.sb.login('jane@example.com', e.lastKey()));
});

test('doPost swallows errors (Supabase down) without leaking details', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  e.sb.down = true;
  assert.equal(post(e, { secret: 'shared-secret-value', email: 'jane@example.com' }), 'ok');
  assert.equal(e.sent.length, 1);
});

test('the service key is only ever sent to Supabase, never written anywhere else', () => {
  const e = makeEnv();
  e.submit({ email: 'jane@example.com' });
  assert.ok(!e.sheet.allText().includes('service-key-secret'));
  assert.ok(!e.sent.some(m => JSON.stringify(m).includes('service-key-secret')));
});
