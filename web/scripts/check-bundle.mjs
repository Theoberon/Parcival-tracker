// Phase 7 check: no secret may end up in the browser bundle (or anywhere in the build output).
// Usage:  SUPABASE_SERVICE_ROLE_KEY=<value> RESEND_SHARED_SECRET=<value> ... node scripts/check-bundle.mjs
// Build first with those variables set to unique sentinel values, then run this: it fails if any
// of them (or a service_role JWT, or a service-key-looking string) appears under .next.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), '.next');
const SECRET_ENV = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'RESEND_SHARED_SECRET', 'APPS_SCRIPT_URL'];
const sentinels = SECRET_ENV.map((n) => [n, process.env[n]]).filter(([, v]) => v && v.length >= 8);
if (!sentinels.length) {
  console.error('Set at least one of ' + SECRET_ENV.join(', ') + ' to a sentinel value for the build, then re-run.');
  process.exit(2);
}

const decodeJwtRole = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role; } catch { return null; } };
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;

let files = 0;
const problems = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'cache') walk(p); continue; }
    if (st.size > 20_000_000) continue;
    files++;
    const text = readFileSync(p, 'latin1');
    for (const [name, value] of sentinels) if (text.includes(value)) problems.push(`${path.relative(root, p)} contains the value of ${name}`);
    for (const jwt of text.match(JWT_RE) ?? []) if (decodeJwtRole(jwt) === 'service_role') problems.push(`${path.relative(root, p)} contains a service_role JWT`);
  }
})(root);

if (problems.length) { console.error('SECRETS FOUND:\n  ' + [...new Set(problems)].join('\n  ')); process.exit(1); }
console.log(`checked ${files} build files for ${sentinels.map(([n]) => n).join(', ')} and service_role JWTs: none found`);
