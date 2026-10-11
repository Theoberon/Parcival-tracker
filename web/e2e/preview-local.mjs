// One command to click through the site on your own computer, with sample data and no Supabase:
//   cd web && npm install && npm run preview
// Starts a small stand-in for the Supabase APIs on :54321 and the site on http://localhost:3000.
// Sample logins are printed below. Nothing you do is saved; restarting resets everything.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-supabase.mjs';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = createMock();
await mock.listen(54321);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sample-anon-key' };
const site = spawn(process.execPath, [path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', '3000'], { cwd: web, env, stdio: 'inherit' });
console.log(`
  Sample data preview
  -------------------
  Open http://localhost:3000
  Member   http://localhost:3000/login        maya / member@x.test      key: ABCD-2345-EFGH
  Admin    http://localhost:3000/admin/login  admin@x.test              password: adminpass1
  Owner    http://localhost:3000/admin/login  owner@x.test              password: ownerpass1
  Delay demo: log in as lockme@x.test with wrong keys (right key: ABCD-2345-ZZZZ)
  Press Ctrl+C to stop.
`);
const stop = () => { site.kill(); mock.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
site.on('exit', stop);
