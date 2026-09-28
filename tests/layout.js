// 글자 깨짐 검사: 대시보드 전 메뉴 + 모바일 앱 2개를 폰(390px)·PC(1280px)로 띄워
// tests/layout-probe.js 로 세로 쪼개짐·잘림·겹침·화면 밖을 찾는다.
//   node tests/layout.js            → 결과 출력 + tests/.shots/layout.json
//   node tests/layout.js --baseline → 지금 결과를 tests/layout-baseline.json 으로 저장
// 기준(baseline)보다 늘어난 문제가 있으면 실패로 끝난다.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const probe = fs.readFileSync(path.join(__dirname, 'layout-probe.js'), 'utf8');
const nm = (p) => path.join(ROOT, 'node_modules', p);
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, pc: { viewport: { width: 1280, height: 900 } } };

async function route(ctx) {
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('https://app.test/')) {
      const f = path.join(ROOT, decodeURIComponent(new URL(u).pathname.slice(1)) || 'index.html');
      return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' });
    }
    if (u.includes('chart.umd')) return r.fulfill({ path: nm('chart.js/dist/chart.umd.min.js'), contentType: 'application/javascript' });
    if (u.includes('supabase-js')) {
      if (u.includes('esm.sh')) return r.fulfill({ contentType: 'application/javascript', body: 'export const createClient=(...a)=>window.__SB_MOD.createClient(...a);' });
      return r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:(...a)=>window.__SB_MOD.createClient(...a)};' });
    }
    return r.abort();
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const result = {};
  for (const [vname, opts] of Object.entries(VIEWS)) {
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript(mock); await ctx.addInitScript(probe); await route(ctx);
    const page = await ctx.newPage();
    await page.goto('https://app.test/index.html'); await page.waitForTimeout(1500);
    const subs = await page.evaluate(() => Object.entries(SECTION_SUBS).flatMap(([s, l]) => l.filter(x => x[0] !== '#').map(x => s + '/' + x[0])));
    for (const k of subs) {
      const [s, sub] = k.split('/');
      await page.evaluate(([s, sub]) => goTo(s, sub), [s, sub]); await page.waitForTimeout(350);
      (result[k] ||= {})[vname] = await page.evaluate(() => window.__layoutProbe('#app'));
    }
    for (const [k, url] of [['app/gagyebu', 'gagyebu.html'], ['app/date', 'date/index.html']]) {
      const p2 = await ctx.newPage(); await p2.goto('https://app.test/' + url); await p2.waitForTimeout(1500);
      (result[k] ||= {})[vname] = await p2.evaluate(() => window.__layoutProbe('body')); await p2.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.mkdirSync(path.join(__dirname, '.shots'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '.shots', 'layout.json'), JSON.stringify(result, null, 1));
  const basePath = path.join(__dirname, 'layout-baseline.json');
  if (process.argv.includes('--baseline')) { fs.writeFileSync(basePath, JSON.stringify(result, null, 1)); console.log('기준 저장'); }
  const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : {};
  let worse = 0, total = 0;
  for (const [k, v] of Object.entries(result)) for (const [vn, m] of Object.entries(v)) for (const [kind, arr] of Object.entries(m)) {
    total += arr.length;
    const old = new Set(((base[k] || {})[vn] || {})[kind] || []);
    const added = arr.filter(x => !old.has(x));
    if (arr.length) console.log(`${k.padEnd(20)} ${vn.padEnd(5)} ${kind.padEnd(9)} ${arr.length}${added.length && Object.keys(base).length ? '  (+' + added.length + ' 새로 생김: ' + added.slice(0, 3).join(' | ') + ')' : ''}  예: ${arr.slice(0, 3).join(' | ')}`);
    if (Object.keys(base).length) worse += added.length;
  }
  console.log(`글자 문제 총 ${total}건${Object.keys(base).length ? ` · 기준보다 새로 생긴 것 ${worse}건` : ''}`);
  process.exit(worse ? 1 : 0);
})();
