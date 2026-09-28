// DB 구조 스냅샷 검사: 빈 Postgres(PGlite)에 supabase/schema 를 순서대로 적용하고,
// 만들어진 구조의 지문이 expected.md5(= 실제 DB) 와 같은지 본다.  npm run test:schema
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path'; import { fileURLToPath } from 'url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'schema');
const db = new PGlite();
// Supabase 가 기본으로 주는 것들의 최소 흉내
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`);
const files = fs.readdirSync(dir).filter(f => /^\d\d_.*\.sql$/.test(f)).sort();
for (const f of files) {
  try { await db.exec(fs.readFileSync(`${dir}/${f}`, 'utf8')); console.log('ok  ', f); }
  catch (e) { console.log('FAIL', f, e.message); process.exit(1); }
}
const q = async (s) => (await db.query(s)).rows[0];
console.log(await q(`select count(*) filter (where relkind='r') tables, count(*) filter (where relkind='v') views from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'`));
console.log(await q(`select count(*) policies from pg_policy`));
const verify = fs.readFileSync(`${dir}/verify.sql`, 'utf8');
const got = Object.fromEntries((await db.query(verify)).rows.map(r => [r.part, r.md5]));
const exp = Object.fromEntries(fs.readFileSync(`${dir}/expected.md5`, 'utf8').trim().split('\n').map(l => l.split(' ')));
for (const k of Object.keys(exp)) console.log(k.padEnd(7), got[k] === exp[k] ? 'same' : 'DIFF');
