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
    if (u.includes('papaparse')) return r.fulfill({ path: nm('papaparse/papaparse.min.js'), contentType: 'application/javascript' });
    if (u.includes('docs.google.com')) return r.fulfill({ status: 403, body: '<html>' });
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
