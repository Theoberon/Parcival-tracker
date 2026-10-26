/**
 * Contest Scoreboard: registration intake.
 * Bound to the Google Sheet that receives the Form responses. See README.md for setup.
 *
 * Script-owned columns (appended to the right of the Form columns, never inserted):
 *   Member ID | Key version | Key issued at | Sync status | Last synced | Email status |
 *   Active | Synced fingerprint | Notes
 * No key and no key hash is ever written to the Sheet.
 */

var SCRIPT_COLUMNS = ['Member ID', 'Key version', 'Key issued at', 'Sync status', 'Last synced',
                      'Email status', 'Active', 'Synced fingerprint', 'Notes'];

// ---------------------------------------------------------------------------------------------
// Triggers / entry points
// ---------------------------------------------------------------------------------------------

/** Installable trigger: Form submit. */
function onFormSubmit(e) {
  if (!e || !e.range || typeof e.range.getSheet !== 'function' || typeof e.range.getRow !== 'function') {
    console.error('onFormSubmit received no spreadsheet range. Install the form-submit trigger from the response spreadsheet using installTriggers; reconcile will retry the response.');
    return;
  }
  withLock_(function () {
    var sheet = e.range.getSheet();
    var c = columns_(sheet);
    var row = e.range.getRow();
    // Already handled (e.g. by the reconcile picking up a missed row first)? Do not rotate twice.
    if (readRow_(sheet, row, c).syncStatus) return;
    processRegistration_(sheet, row, c);
  });
}

// Apps Script stops a run after 6 minutes. Stop cleanly before that; the next run carries on
// (rows are handled in order and finished rows are skipped cheaply).
var RECONCILE_BUDGET_MS = 4.5 * 60 * 1000;

/** Time trigger (every 10 minutes). */
function reconcile() {
  withLock_(function () {
    var started = Date.now();
    var sheet = responsesSheet_();
    var c = columns_(sheet);
    var errors = [];
    for (var row = 2; row <= sheet.getLastRow(); row++) {
      if (Date.now() - started > RECONCILE_BUDGET_MS) {
        errors.push('time budget reached at row ' + row + '; the rest is handled in the next run');
        break;
      }
      try { reconcileRow_(sheet, row, c); }
      catch (err) { errors.push('row ' + row + ': ' + err.message); }
    }
    try { writeOrphans_(sheet, c); } catch (err) { errors.push('orphans: ' + err.message); }
    if (errors.length) console.error('reconcile problems: ' + errors.join(' | '));
  });
}

/** Run this once from the editor to install both triggers (idempotent). */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'onFormSubmit' || h === 'reconcile') ScriptApp.deleteTrigger(t);
  });
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('reconcile').timeBased().everyMinutes(10).create();
}

// ---------------------------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------------------------
function onOpen() {
  var quota = '(open to see)';
  try { quota = String(MailApp.getRemainingDailyQuota()); } catch (err) { /* simple triggers cannot use MailApp */ }
  SpreadsheetApp.getUi().createMenu('Contest')
    .addItem('Sync selected row now', 'menuSyncSelected')
    .addItem('Sync all now', 'menuSyncAll')
    .addItem('Resend key for selected row', 'menuResendSelected')
    .addItem('Close registration now', 'menuCloseRegistration')
    .addSeparator()
    .addItem('Emails left today: ' + quota, 'menuShowQuota')
    .addToUi();
}

function menuSyncSelected() {
  var ui = SpreadsheetApp.getUi();
  var sheet = responsesSheet_();
  var row = selectedRow_(sheet);
  if (!row) return ui.alert('Select a response row first.');
  withLock_(function () {
    var c = columns_(sheet);
    var d = readRow_(sheet, row, c);
    if (d.memberId && (d.syncStatus === 'OK' || /^Sync error/.test(d.syncStatus))) pushChanges_(sheet, row, c);
    else processRegistration_(sheet, row, c);
  });
  ui.alert('Row ' + row + ': ' + readRow_(sheet, row, columns_(sheet)).syncStatus);
}

function menuSyncAll() {
  reconcile();
  SpreadsheetApp.getUi().alert('Sync finished. Check the "Sync status" column for any failures.');
}

function menuResendSelected() {
  var ui = SpreadsheetApp.getUi();
  var sheet = responsesSheet_();
  var row = selectedRow_(sheet);
  if (!row) return ui.alert('Select a response row first.');
  withLock_(function () {
    var c = columns_(sheet);
    var d = readRow_(sheet, row, c);
    var ok = resendKeyForEmail_(d.email, { sheet: sheet, row: row, c: c });
    ui.alert(ok ? 'A new key was emailed to ' + d.email + '. The old key no longer works.'
                : 'No active member with that email. Nothing was sent.');
  });
}

function menuCloseRegistration() {
  closeForm_();
  SpreadsheetApp.getUi().alert('The Form no longer accepts responses.');
}

function menuShowQuota() {
  SpreadsheetApp.getUi().alert('Emails left today: ' + MailApp.getRemainingDailyQuota() +
    '\n(Personal Gmail accounts can send about 100 per day.)');
}

// ---------------------------------------------------------------------------------------------
// Registration flow
// ---------------------------------------------------------------------------------------------

/**
 * Create, then email. Existing organisation members keep their current key.
 */
function processRegistration_(sheet, row, c) {
  var d = readRow_(sheet, row, c);
  var set = function (name, value) { setCell_(sheet, row, c, name, value); };
  var finish = function (status) { set('Sync status', status); set('Last synced', new Date()); };

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return finish('Rejected: invalid email');
  if (!d.displayName) return finish('Rejected: display name missing');

  try {
    if (isAdminEmail_(d.email)) return finish('Admin email — rejected');

    var existing = findMemberByEmail_(d.email);
    if (existing && !existing.active) {
      set('Member ID', existing.id);
      set('Active', false);
      return finish('Deactivated — no key sent');
    }
    var issued;
    if (existing) {
      if (d.title && d.title !== existing.title) {
        existing = updateMemberProfile_(existing, { title: d.title });
      }
      writeExistingMember_(sheet, row, c, existing);
      set('Notes', 'Returning participant — existing login key retained.');
      finish('OK');
      deliverExistingNotice_(sheet, row, c, existing);
      return;
    }
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('email quota exhausted for today');
    issued = createMember_(d);
    writeIssued_(sheet, row, c, issued.member, d);
    set('Notes', issued.note || '');
    finish('OK');
    deliverKey_(sheet, row, c, issued);
  } catch (err) {
    finish('Failed: ' + err.message);
  }
}

/** Create Auth identity, then atomically add the organisation roster and current contest row. */
function createMember_(d) {
  var key = generateKey();
  var userId;
  try {
    userId = authCreateUser_(d.email, key).id;
  } catch (err) {
    if (err.status !== 422 && err.code !== 'email_exists') throw err;
    // A previous attempt created the Auth user but not the organisation roster: adopt it.
    userId = sbRpc_('auth_user_id_by_email', { p_email: d.email });
    if (!userId) throw err;
    if (findMemberById_(userId) || findContestMemberById_(userId)) {
      throw new Error('This email is already assigned to another contest or organisation. Use a different email.');
    }
    authUpdateUser_(userId, { password: key, email_confirm: true });
  }
  var rows = sbRpc_('register_organization_member', {
    p_organization_id: organizationId_(),
    p_member_id: userId,
    p_email: d.email,
    p_display_name: d.displayName,
    p_title: d.title || null
  });
  var member = rows && rows.length ? rows[0] : null;
  if (!member) throw new Error('Supabase did not return the new organisation member.');
  return {
    member: member, key: key, rotated: false,
    note: member.display_name !== d.displayName ? 'Display name "' + d.displayName + '" was taken; using "' + member.display_name + '".' : ''
  };
}

/** Existing member: new key, old sessions revoked, key_version + 1. */
function rotateKey_(member) {
  var key = generateKey();
  authUpdateUser_(member.id, { password: key });
  revokeSessions_(member.id);
  var updated = sbPatch_('organization_members', 'id=eq.' + member.id, { key_version: member.key_version + 1 })[0];
  sbPatch_('members', 'id=eq.' + member.id, { key_version: updated.key_version });
  return { member: updated, key: key, rotated: true, note: '' };
}

function updateMemberProfile_(member, changes) {
  var updated = sbPatch_('organization_members', 'id=eq.' + member.id, changes)[0];
  if (!updated) throw new Error('Organisation member not found in Supabase.');
  sbPatch_('members', 'id=eq.' + member.id, changes);
  return updated;
}

/** Used by the website's "Resend my key" (via doPost) and the menu. Returns false if nobody was emailed. */
function resendKeyForEmail_(email, sheetCtx) {
  email = normalizeEmail_(email);
  var member = email ? findMemberByEmail_(email) : null;
  if (!member || !member.active) return false;
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('email quota exhausted for today');
  var issued = rotateKey_(member);
  // From here on the old key is dead: the email MUST go out even if the Sheet bookkeeping fails.
  var ctx = null;
  try {
    ctx = sheetCtx || locateRow_(email);
    if (ctx) {
      setCell_(ctx.sheet, ctx.row, ctx.c, 'Member ID', issued.member.id);
      setCell_(ctx.sheet, ctx.row, ctx.c, 'Key version', issued.member.key_version);
      setCell_(ctx.sheet, ctx.row, ctx.c, 'Key issued at', new Date());
      setCell_(ctx.sheet, ctx.row, ctx.c, 'Last synced', new Date());
    }
  } catch (err) {
    console.error('sheet update after key rotation failed: ' + err.message);
  }
  deliverKey_(ctx && ctx.sheet, ctx && ctx.row, ctx && ctx.c, issued);
  return true;
}

function writeIssued_(sheet, row, c, member, d) {
  var set = function (name, value) { setCell_(sheet, row, c, name, value); };
  set('Member ID', member.id);
  set('Key version', member.key_version);
  set('Key issued at', new Date());
  setActiveCell_(sheet, row, c, true);
  set('Synced fingerprint', fingerprint_(d.displayName, d.title, true));
}

function writeExistingMember_(sheet, row, c, member) {
  setCell_(sheet, row, c, 'Member ID', member.id);
  setCell_(sheet, row, c, 'Key version', member.key_version);
  setActiveCell_(sheet, row, c, true);
  setCell_(sheet, row, c, 'Synced fingerprint', fingerprint_(member.display_name, member.title, member.active));
}

/** Notify returning participants without rotating or revealing their existing key. */
function deliverExistingNotice_(sheet, row, c, member) {
  var status;
  try {
    var site = cfg_('SITE_URL').replace(/\/+$/, '');
    var body = [
      'Hi ' + member.display_name + ',', '',
      'You are already registered for this contest. Your existing login key is unchanged; use it to log in.',
      '', 'Log in: ' + site + '/login', '',
      'If you lost your key, use "Resend my key" on the login page. That will issue a new key and invalidate the old one.',
      '', 'Questions? ' + cfg_('SUPPORT_CONTACT')
    ].join('\n');
    MailApp.sendEmail({ to: member.email, subject: 'Your contest account is ready', body: body, name: 'Contest' });
    status = 'Existing account — key unchanged';
  } catch (err) {
    status = 'Existing account — notice failed: ' + err.message;
  }
  setCell_(sheet, row, c, 'Email status', status);
  return status;
}

/** Email the key and record the outcome. Never throws. */
function deliverKey_(sheet, row, c, issued) {
  var status;
  try {
    sendKeyEmail_(issued.member.email, issued.member.display_name, issued.key, issued);
    status = 'Sent';
  } catch (err) {
    status = 'Failed: ' + err.message;
  }
  if (sheet) setCell_(sheet, row, c, 'Email status', status);
  return status;
}

function sendKeyEmail_(to, displayName, key, issued) {
  var site = cfg_('SITE_URL').replace(/\/+$/, '');
  var lines = ['Hi ' + displayName + ',', ''];
  if (issued && issued.rotated) lines.push('Here is your NEW contest login key. Your previous key no longer works.');
  else lines.push('You are registered for the contest. Here is your login key.');
  lines.push('', '    ' + formatKey(key), '', 'Log in: ' + site + '/login', '',
    'Keep this key private. Anyone with it can submit as you.', '',
    'Lost it? Use "Resend my key" on the login page: ' + site + '/resend');
  if (issued && issued.note && !issued.rotated) lines.push('', 'Note: ' + issued.note);
  lines.push('', 'Questions? ' + cfg_('SUPPORT_CONTACT'));
  MailApp.sendEmail({ to: to, subject: 'Your contest login key', body: lines.join('\n'), name: 'Contest' });
}

// ---------------------------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------------------------
function reconcileRow_(sheet, row, c) {
  var d = readRow_(sheet, row, c);
  if (!d.email) return;
  if (/^Failed/.test(d.syncStatus)) return processRegistration_(sheet, row, c);
  if (!d.syncStatus) {
    // Form trigger missed it? Give onFormSubmit 5 minutes before stepping in.
    var age = (new Date() - new Date(d.timestamp)) / 60000;
    if (isNaN(age) || age >= 5) processRegistration_(sheet, row, c);
    return;
  }
  if (d.memberId && d.syncStatus === 'OK' && /^Failed/.test(d.emailStatus)) {
    // The key never reached the member: issue a fresh one (we do not keep keys to resend).
    if (MailApp.getRemainingDailyQuota() > 0) resendKeyForEmail_(d.email, { sheet: sheet, row: row, c: c });
    return;
  }
  if (d.memberId && (d.syncStatus === 'OK' || /^Sync error/.test(d.syncStatus))) pushChanges_(sheet, row, c);
}

/** Push owner edits (display name, Active checkbox) to Supabase when the fingerprint changed. */
function pushChanges_(sheet, row, c) {
  var d = readRow_(sheet, row, c);
  var set = function (name, value) { setCell_(sheet, row, c, name, value); };
  var activeNow = d.active === true || String(d.active).toUpperCase() === 'TRUE';
  var fpNow = fingerprint_(d.displayName, d.title, activeNow);
  if (fpNow === d.fingerprint) return;
  try {
    var member = findMemberById_(d.memberId);
    if (!member) throw new Error('member not found in Supabase');
    var old = parseFingerprint_(d.fingerprint);
    var now = parseFingerprint_(fpNow);
    if (old.name !== now.name && d.displayName) {
      var wanted = uniqueDisplayName_(d.displayName, member.id);
      if (wanted !== member.display_name) member = updateMemberProfile_(member, { display_name: wanted });
    }
    if (old.title !== now.title && (d.title || null) !== (member.title || null)) {
      member = updateMemberProfile_(member, { title: d.title || null });
    }
    if (old.active !== now.active && activeNow !== member.active) {
      updateMemberProfile_(member, { active: activeNow });
      if (activeNow) unbanUser_(member.id);
      else { banUser_(member.id); revokeSessions_(member.id); }
    }
    set('Synced fingerprint', fpNow);
    set('Sync status', 'OK');
    set('Last synced', new Date());
  } catch (err) {
    set('Sync status', 'Sync error: ' + err.message);   // retried next run; never rotates a key
  }
}

/** Members that exist in Supabase but have no Sheet row are listed on an "Orphans" tab (never deleted). */
function writeOrphans_(sheet, c) {
  var ids = {};
  var last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, c.m['Member ID'], last - 1, 1).getValues().forEach(function (r) { ids[String(r[0])] = true; });
  }
  var orphans = listMembers_().filter(function (m) { return !ids[m.id]; });
  var ss = SpreadsheetApp.getActive();
  var tab = ss.getSheetByName('Orphans') || ss.insertSheet('Orphans');
  tab.clear();
  tab.getRange(1, 1, 1, 4).setValues([['Member ID', 'Email', 'Display name', 'Active']]);
  if (orphans.length) {
    tab.getRange(2, 1, orphans.length, 4).setValues(orphans.map(function (m) { return [m.id, m.email, m.display_name, m.active]; }));
  }
}

function closeForm_() {
  var url = SpreadsheetApp.getActive().getFormUrl();
  if (!url) return;
  var form = FormApp.openByUrl(url);
  if (form.isAcceptingResponses()) form.setAcceptingResponses(false);
}

// ---------------------------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------------------------
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function responsesSheet_() {
  var name = PropertiesService.getScriptProperties().getProperty('RESPONSES_SHEET') || 'Form Responses 1';
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Tab "' + name + '" not found. Set Script Property RESPONSES_SHEET to the Form responses tab.');
  return sheet;
}

function selectedRow_(sheet) {
  var range = SpreadsheetApp.getActive().getActiveRange();
  if (!range || range.getSheet().getName() !== sheet.getName()) return null;
  var row = range.getRow();
  return row >= 2 ? row : null;
}

/** Header -> column map; appends any missing script column to the right (never inserts). */
function columns_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var m = {};
  headers.forEach(function (h, i) { if (h && !m[h]) m[h] = i + 1; });
  SCRIPT_COLUMNS.forEach(function (name) {
    if (!m[name]) { lastCol++; sheet.getRange(1, lastCol).setValue(name); m[name] = lastCol; }
  });
  var find = function (re) {
    for (var i = 0; i < headers.length; i++) if (re.test(headers[i])) return i + 1;
    return 0;
  };
  return {
    m: m,
    timestamp: find(/^timestamp$/i),
    email: find(/^e-?mail( address)?$/i),
    fullName: find(/full name/i),
    displayName: find(/display name/i),
    title: find(/\btitle\b/i)
  };
}

function readRow_(sheet, row, c) {
  var vals = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var get = function (col) { return col ? vals[col - 1] : ''; };
  var str = function (name) { var v = get(c.m[name]); return v === '' || v === null || v === undefined ? '' : String(v); };
  return {
    row: row,
    timestamp: get(c.timestamp),
    email: normalizeEmail_(get(c.email)),
    displayName: normalizeDisplayName_(get(c.displayName) || get(c.fullName)),
    title: normalizeTitle_(get(c.title)),
    memberId: str('Member ID'),
    syncStatus: str('Sync status'),
    emailStatus: str('Email status'),
    active: get(c.m['Active']),
    fingerprint: str('Synced fingerprint')
  };
}

function setCell_(sheet, row, c, name, value) { sheet.getRange(row, c.m[name]).setValue(value); }

function setActiveCell_(sheet, row, c, value) {
  var range = sheet.getRange(row, c.m['Active']);
  range.insertCheckboxes();
  range.setValue(value);
}

function locateRow_(email) {
  var sheet = responsesSheet_();
  var c = columns_(sheet);
  var last = sheet.getLastRow();
  if (last < 2 || !c.email) return null;
  var emails = sheet.getRange(2, c.email, last - 1, 1).getValues();
  for (var i = emails.length - 1; i >= 0; i--) {
    if (normalizeEmail_(emails[i][0]) === email) return { sheet: sheet, row: i + 2, c: c };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------------------------
function normalizeEmail_(s) { return String(s === null || s === undefined ? '' : s).trim().toLowerCase(); }

/** Trim, collapse spaces; title-case only when the whole name is lower- or upper-case. */
function normalizeDisplayName_(s) {
  var t = String(s === null || s === undefined ? '' : s).trim().replace(/\s+/g, ' ');
  if (t && (t === t.toLowerCase() || t === t.toUpperCase())) {
    t = t.toLowerCase().replace(/(^|\s)(\S)/g, function (m, sp, ch) { return sp + ch.toUpperCase(); });
  }
  return t.slice(0, 60);
}

/** Free text such as "HubSpot Specialist": trimmed, single spaces, at most 80 characters. Case is kept. */
function normalizeTitle_(s) {
  return String(s === null || s === undefined ? '' : s).trim().replace(/\s+/g, ' ').slice(0, 80);
}

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b < 0 ? b + 256 : b) + 0x100).toString(16).slice(1); }).join('');
}

/** "<hash of display name>|<hash of title>|<1 or 0 for Active>" */
function fingerprint_(displayName, title, active) {
  return sha256Hex_(displayName).slice(0, 16) + '|' + sha256Hex_(title || '').slice(0, 16) + '|' + (active ? '1' : '0');
}

/** Also reads the older two-part form (name|active): its title part is unknown, so a title gets pushed once. */
function parseFingerprint_(fp) {
  var p = String(fp || '').split('|');
  if (p.length === 2) return { name: p[0], title: null, active: p[1] };
  return { name: p[0], title: p[1], active: p[2] };
}
