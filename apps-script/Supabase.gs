/** Supabase REST + Auth admin API helpers. Uses the service key from Script Properties only. */

function cfg_(name) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Missing Script Property: ' + name);
  return v;
}

function sbFetch_(method, path, body, extraHeaders) {
  var key = cfg_('SUPABASE_SERVICE_KEY');
  var headers = { apikey: key, Authorization: 'Bearer ' + key };
  for (var h in (extraHeaders || {})) headers[h] = extraHeaders[h];
  var opts = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== undefined) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(cfg_('SUPABASE_URL').replace(/\/+$/, '') + path, opts);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
  if (code >= 300) {
    var detail = (json && (json.msg || json.message || json.error_description || json.error)) || String(text).slice(0, 200);
    var e = new Error('Supabase ' + code + ': ' + detail);
    e.status = code;
    e.code = json && (json.error_code || json.code);
    throw e;
  }
  return json;
}

function sbSelect_(table, query) { return sbFetch_('get', '/rest/v1/' + table + '?' + query); }
function sbInsert_(table, row) {
  return sbFetch_('post', '/rest/v1/' + table, row, { Prefer: 'return=representation' })[0];
}
function sbPatch_(table, query, row) {
  return sbFetch_('patch', '/rest/v1/' + table + '?' + query, row, { Prefer: 'return=representation' });
}
function sbRpc_(fn, args) { return sbFetch_('post', '/rest/v1/rpc/' + fn, args || {}); }

function authCreateUser_(email, password) {
  return sbFetch_('post', '/auth/v1/admin/users', { email: email, password: password, email_confirm: true });
}
function authUpdateUser_(id, attrs) { return sbFetch_('put', '/auth/v1/admin/users/' + id, attrs); }
function banUser_(id) { return authUpdateUser_(id, { ban_duration: '876000h' }); }   // ~100 years
function unbanUser_(id) { return authUpdateUser_(id, { ban_duration: 'none' }); }
function revokeSessions_(id) { return sbRpc_('revoke_user_sessions', { p_user: id }); }

function q_(v) { return encodeURIComponent(v); }
function organizationId_() { return cfg_('ORGANIZATION_ID'); }

function isAdminEmail_(email) {
  return sbSelect_('admins', 'email=eq.' + q_(email) + '&select=id').length > 0;
}
function findMemberByEmail_(email) {
  var rows = sbSelect_('organization_members', 'organization_id=eq.' + organizationId_() + '&email=eq.' + q_(email) + '&select=*');
  return rows.length ? rows[0] : null;
}
function findMemberById_(id) {
  var rows = sbSelect_('organization_members', 'id=eq.' + id + '&select=*');
  return rows.length ? rows[0] : null;
}
function findContestMemberById_(id) {
  var rows = sbSelect_('members', 'id=eq.' + id + '&select=id,organization_id');
  return rows.length ? rows[0] : null;
}
function listMembers_() {
  return sbSelect_('organization_members', 'organization_id=eq.' + organizationId_() + '&select=id,email,display_name,active&order=registered_at');
}

/** "Ann", then "Ann 2", "Ann 3"... Case-insensitive; ignores the member's own current name. */
function uniqueDisplayName_(name, excludeMemberId) {
  var base = name.slice(0, 50);
  var rows = sbSelect_('organization_members', 'organization_id=eq.' + organizationId_() + '&display_name=ilike.' + q_(base + '*') + '&select=id,display_name');
  var taken = {};
  rows.forEach(function (r) { if (r.id !== excludeMemberId) taken[r.display_name.toLowerCase()] = true; });
  var candidate = base, n = 1;
  while (taken[candidate.toLowerCase()]) { n++; candidate = base + ' ' + n; }
  return candidate;
}
