// 화면 회귀 검사: 기준 커밋(기본 HEAD)과 지금 작업본을 같은 가짜 데이터로 띄워
// 모든 메뉴 화면을 찍고 픽셀 단위로 비교한다.
//   npm test                 → HEAD 와 비교
//   node tests/visual.js <ref> → 특정 커밋과 비교
// 결과: tests/.shots/ 에 스크린샷과 차이 이미지
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os'), { execSync } = require('child_process');
const { PNG } = require('pngjs'); const pixelmatch = require('pixelmatch');

const ROOT = path.resolve(__dirname, '..');
const ref = process.argv[2] || 'HEAD';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'haedal-base-'));
execSync(`git -C "${ROOT}" archive ${ref} | tar -x -C "${base}"`);
const OUT = path.join(__dirname, '.shots'); fs.rmSync(OUT, { recursive: true, force: true });
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const nm = (p) => path.join(ROOT, 'node_modules', p);

async function shoot(browser, dir, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(mock);
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('https://app.test/')) {
      const f = path.join(dir, new URL(u).pathname.slice(1) || 'index.html');
      return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' });
    }
    if (u.includes('chart.umd')) return r.fulfill({ path: nm('chart.js/dist/chart.umd.min.js'), contentType: 'application/javascript' });
    /* 예전 코드가 esm.sh 에서 직접 받던 supabase-js 도 가짜로 돌려준다 (기준 커밋 비교용) */
    if (u.includes('esm.sh/@supabase/supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: 'export const createClient = (...a) => window.__SB_MOD.createClient(...a);' });
    return r.abort();
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('https://app.test/index.html'); await page.waitForTimeout(1500);
  const subs = await page.evaluate(() => Object.entries(SECTION_SUBS).flatMap(([s, l]) => l.filter(x => x[0] !== '#').map(x => s + '/' + x[0])));
  const shots = {};
  fs.mkdirSync(path.join(OUT, tag), { recursive: true });
  for (const k of subs) {
    const [s, sub] = k.split('/');
    await page.evaluate(([s, sub]) => goTo(s, sub), [s, sub]); await page.waitForTimeout(350);
    shots[k] = await page.screenshot({ fullPage: true, animations: 'disabled' });
    fs.writeFileSync(path.join(OUT, tag, k.replace('/', '_') + '.png'), shots[k]);
  }
  /* 모바일 앱 두 개는 첫 화면만 비교한다 */
  for (const [k, url] of [['app/gagyebu', 'gagyebu.html'], ['app/date', 'date/index.html']]) {
    const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(k + ': ' + e.message));
    await p2.setViewportSize({ width: 420, height: 860 });
    await p2.goto('https://app.test/' + url); await p2.waitForTimeout(1500);
    shots[k] = await p2.screenshot({ fullPage: true, animations: 'disabled' });
    fs.writeFileSync(path.join(OUT, tag, k.replace('/', '_') + '.png'), shots[k]);
    await p2.close();
  }
  await ctx.close();
  return { shots, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const a = await shoot(browser, base, 'base'), b = await shoot(browser, ROOT, 'work');
  await browser.close();
  let bad = 0;
  if (b.errs.length) { bad++; console.log('페이지 오류:', b.errs); }
  for (const k of Object.keys(b.shots)) {
    if (!a.shots[k]) { console.log('새 화면', k); continue; }
    const x = PNG.sync.read(a.shots[k]), y = PNG.sync.read(b.shots[k]);
    if (x.width !== y.width || x.height !== y.height) { bad++; console.log('크기 다름', k, `${x.width}x${x.height} → ${y.width}x${y.height}`); continue; }
    const d = new PNG({ width: x.width, height: x.height });
    const n = pixelmatch(x.data, y.data, d.data, x.width, x.height, { threshold: 0.1 });
    if (n) { bad++; fs.writeFileSync(path.join(OUT, 'diff_' + k.replace('/', '_') + '.png'), PNG.sync.write(d)); console.log('차이', k, n + 'px'); }
  }
  console.log(`${Object.keys(b.shots).length}개 화면 비교 · 차이 ${bad}건 (기준 ${ref})`);
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
})();
