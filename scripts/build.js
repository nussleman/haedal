// 배포용 묶음 만들기: js/order.txt 순서대로 js/ 파일을 이어 붙이고 줄여서 dist/app.js 로,
// css/style.css 는 줄여서 dist/style.css 로. index.html 의 주소 뒤 ?v= 는 내용 해시로 자동 갱신.
//   npm run build           → 만들기
//   npm run build -- --check → 만들어 둔 것이 js/·css/ 와 같은지 확인만 (다르면 실패)
// js/ 파일은 모듈이 아닌 일반 스크립트라 전역 이름(함수·상수)은 줄이지 않는다.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
const order = fs.readFileSync(path.join(ROOT, 'js/order.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const src = order.map(f => `/* ── ${f} ── */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
const js = esbuild.transformSync(src, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' }).code;
const css = esbuild.transformSync(fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8'), { loader: 'css', minify: true }).code;
const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const files = { 'dist/app.js': js, 'dist/style.css': css };
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/dist\/app\.js\?v=\w+/, `dist/app.js?v=${h(js)}`).replace(/dist\/style\.css\?v=\w+/, `dist/style.css?v=${h(css)}`);
const shared = fs.readFileSync(path.join(ROOT, 'shared/supabase.js'), 'utf8');
html = html.replace(/shared\/supabase\.js\?v=\w+/, `shared/supabase.js?v=${h(shared)}`);
files['index.html'] = html;
/* 가계부·데이트 통장도 공용 파일 주소의 ?v= 를 맞춘다 */
for (const f of ['gagyebu.html', 'date/index.html']) {
  const cur = fs.readFileSync(path.join(ROOT, f), 'utf8');
  files[f] = cur.replace(/shared\/supabase\.js\?v=\w+/, `shared/supabase.js?v=${h(shared)}`);
}
let stale = [];
for (const [f, body] of Object.entries(files)) {
  const p = path.join(ROOT, f);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (cur !== body) { stale.push(f); if (!check) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); } }
}
if (check) {
  if (stale.length) { console.error('배포 묶음이 최신이 아님 — npm run build 를 돌리세요:', stale.join(', ')); process.exit(1); }
  console.log('배포 묶음 최신');
} else {
  console.log(`dist/app.js ${(js.length / 1024).toFixed(0)}KB (원본 ${(src.length / 1024).toFixed(0)}KB) · dist/style.css ${(css.length / 1024).toFixed(0)}KB · 바뀐 파일: ${stale.join(', ') || '없음'}`);
}
