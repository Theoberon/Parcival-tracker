import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuid, organizationScopeFromCookie } from './organization-scope.ts';

test('organisation scope accepts only a UUID cookie value', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  assert.equal(organizationScopeFromCookie(`theme=dark; parcival-org-scope=${id}`), id);
  assert.equal(organizationScopeFromCookie('parcival-org-scope=not-a-uuid'), null);
  assert.equal(organizationScopeFromCookie('parcival-org-scoped=22222222-2222-4222-8222-222222222222'), null);
  assert.equal(isUuid(undefined), false);
});
