// Loads the .gs files into a vm context with in-memory fakes of the Google + Supabase APIs.
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC = path.join(__dirname, '..');
const FILES = ['Keys.gs', 'Supabase.gs', 'Code.gs', 'Resend.gs'];

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  getValue() { return this.sheet.get(this.r, this.c); }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v))); return this; }
  insertCheckboxes() { return this; }
  getRow() { return this.r; }
  getSheet() { return this.sheet; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.cells = {}; }
  get(r, c) { const v = this.cells[r + ',' + c]; return v === undefined ? '' : v; }
  set(r, c, v) { this.cells[r + ',' + c] = v; }
  getName() { return this.name; }
  getLastRow() { return Math.max(0, ...Object.keys(this.cells).map(k => +k.split(',')[0])); }
  getLastColumn() { return Math.max(0, ...Object.keys(this.cells).map(k => +k.split(',')[1])); }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  clear() { this.cells = {}; }
  headers() { const out = {}; for (let c = 1; c <= this.getLastColumn(); c++) out[this.get(1, c)] = c; return out; }
  /** value by header name */
  val(row, header) { return this.get(row, this.headers()[header]); }
  addResponse({ email, fullName = 'Test Person', displayName = 'Test', title = '', timestamp = new Date() }) {
    const h = this.headers();
    const row = this.getLastRow() + 1;
    this.set(row, h['Timestamp'], timestamp);
    this.set(row, h['Email Address'], email);
    this.set(row, h['Full name'], fullName);
    this.set(row, h['Display name'], displayName);
    if (h['Title']) this.set(row, h['Title'], title);
    return row;
  }
  allText() { return Object.values(this.cells).map(String).join('\n'); }
}

/** Minimal Supabase: Postgres tables we touch + PostgREST filters + GoTrue admin API. */
class FakeSupabase {
  constructor() {
    this.down = false;
    this.contestId = 'contest-1';
    this.contest = { id: this.contestId, start_at: '2026-01-01T00:00:00Z', end_at: '2999-01-01T00:00:00Z', grace_minutes: 10 };
    this.status = 'open';
    this.members = []; this.admins = []; this.users = new Map(); this.sessions = new Map();
  }
  login(email, key) {
    const u = [...this.users.values()].find(x => x.email.toLowerCase() === email.toLowerCase());
    return !!u && !u.banned && u.password === key.replace(/[\s-]/g, '').toUpperCase();
  }
  handle(method, url, body) {
    (this.calls ??= []).push(method + ' ' + new URL(url).pathname.split('/').pop());
    if (this.down) return [503, { message: 'service unavailable' }];
    const u = new URL(url);
    const p = u.pathname;
    let m;
    if (method === 'post' && p === '/auth/v1/admin/users') {
      if ([...this.users.values()].some(x => x.email.toLowerCase() === body.email.toLowerCase()))
        return [422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' }];
      const id = crypto.randomUUID();
      this.users.set(id, { id, email: body.email, password: body.password, banned: false });
      this.sessions.set(id, 1);
      return [200, { id, email: body.email }];
    }
    if ((m = p.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/)) && method === 'put') {
      const user = this.users.get(m[1]);
      if (!user) return [404, { msg: 'User not found' }];
      if (body.password) user.password = body.password;
      if (body.ban_duration) user.banned = body.ban_duration !== 'none';
      return [200, { id: user.id }];
    }
    if ((m = p.match(/^\/rest\/v1\/rpc\/(.+)$/)) && method === 'post') {
      if (m[1] === 'contest_effective_status') return [200, this.status];
      if (m[1] === 'revoke_user_sessions') { this.sessions.set(body.p_user, 0); return [200, null]; }
      if (m[1] === 'auth_user_id_by_email') {
        const x = [...this.users.values()].find(v => v.email.toLowerCase() === body.p_email.toLowerCase());
        return [200, x ? x.id : null];
      }
      return [404, { message: 'no such rpc' }];
    }
    if ((m = p.match(/^\/rest\/v1\/(contests|members|admins)$/))) {
      const table = m[1];
      if (method === 'get' && table === 'contests') return [200, [this.contest]];
      const rows = table === 'members' ? this.members : this.admins;
      const match = (row) => [...u.searchParams.entries()].every(([k, v]) => {
        if (k === 'select' || k === 'order') return true;
        const [op, ...rest] = v.split('.'); const val = rest.join('.');
        const cell = String(row[k]).toLowerCase();
        if (op === 'eq') return cell === val.toLowerCase();
        if (op === 'ilike') return new RegExp('^' + val.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(cell);
        throw new Error('fake: unsupported op ' + op);
      });
      if (method === 'get') return [200, rows.filter(match).map(r => ({ ...r }))];
      if (method === 'post') {
        if (this.admins.some(a => a.email.toLowerCase() === body.email.toLowerCase())) return [400, { message: 'admin_email: ...' }];
        if (rows.some(r => r.email.toLowerCase() === body.email.toLowerCase() || r.display_name.toLowerCase() === body.display_name.toLowerCase()))
          return [409, { code: '23505', message: 'duplicate key value violates unique constraint' }];
        const row = { key_version: 1, active: true, ...body };
        rows.push(row);
        return [201, [{ ...row }]];
      }
      if (method === 'patch') {
        const hit = rows.filter(match);
        hit.forEach(r => Object.assign(r, body));
        return [200, hit.map(r => ({ ...r }))];
      }
    }
    return [404, { message: 'fake: unhandled ' + method + ' ' + url }];
  }
}

function makeEnv(opts = {}) {
  const sb = new FakeSupabase();
  const sheet = new FakeSheet('Form Responses 1');
  ['Timestamp', 'Email Address', 'Full name', 'Display name', 'Title', 'Team access code', 'Consent'].forEach((h, i) => sheet.set(1, i + 1, h));
  const orphansSheets = {};
  const sent = [];
  const form = { accepting: true, isAcceptingResponses() { return this.accepting; }, setAcceptingResponses(v) { this.accepting = v; } };
  const state = { mailQuota: 100, mailFails: false, alerts: [], menus: [], triggers: [] };
  const props = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key-secret', CONTEST_ID: sb.contestId,
    RESEND_SHARED_SECRET: 'shared-secret-value', SITE_URL: 'https://contest.example.com', SUPPORT_CONTACT: 'help@example.com',
  };
  const active = { range: null };
  const ss = {
    getSheetByName: (n) => (n === sheet.name ? sheet : orphansSheets[n] || null),
    insertSheet: (n) => (orphansSheets[n] = new FakeSheet(n)),
    getFormUrl: () => 'https://forms.example/form',
    getActiveRange: () => active.range,
  };
  const ctx = {
    console,
    Date, Math, JSON, String, Number, Object, Array, isNaN, parseInt, encodeURIComponent, Error, RegExp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActive: () => ss,
      getUi: () => ({ alert: (m) => state.alerts.push(m), createMenu: (n) => { const items = []; const menu = { addItem: (l, f) => (items.push([l, f]), menu), addSeparator: () => menu, addToUi: () => state.menus.push([n, items]) }; return menu; } }),
    },
    FormApp: { openByUrl: () => form },
    MailApp: {
      getRemainingDailyQuota: () => state.mailQuota,
      sendEmail: (o) => { if (state.mailFails) throw new Error('mail service down'); state.mailQuota--; sent.push(o); },
    },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.map(t => ({ getHandlerFunction: () => t.fn, t })),
      deleteTrigger: ({ t }) => { state.triggers = state.triggers.filter(x => x !== t); },
      newTrigger: (fn) => { const t = { fn }; const b = { forSpreadsheet: () => b, onFormSubmit: () => b, timeBased: () => b, everyMinutes: () => b, create: () => state.triggers.push(t) }; return b; },
    },
    ContentService: { MimeType: { TEXT: 'TEXT' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        if (o.headers.Authorization !== 'Bearer ' + props.SUPABASE_SERVICE_KEY) throw new Error('fake: missing service key');
        const [code, json] = sb.handle(o.method, url, o.payload ? JSON.parse(o.payload) : undefined);
        const text = json === null || json === undefined ? '' : JSON.stringify(json);
        return { getResponseCode: () => code, getContentText: () => text };
      },
    },
  };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });

  const env = {
    ctx, sb, sheet, sent, form, state, props, orphansSheets,
    selectRow(r) { active.range = new FakeRange(sheet, r, 1, 1, 1); },
    /** submit a response and fire the trigger, like Google does */
    submit(r) { const row = sheet.addResponse(r); ctx.onFormSubmit({ range: new FakeRange(sheet, row, 1, 1, 6) }); return row; },
    /** the key from the most recent email, as the member would type it */
    lastKey() { const m = sent[sent.length - 1].body.match(/\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/); return m && m[1]; },
    run(code) { return vm.runInContext(code, ctx); },
  };
  return env;
}

module.exports = { makeEnv, FakeSheet, FakeRange };
