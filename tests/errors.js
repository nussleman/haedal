/* 모든 화면을 PC·폰으로 한 번씩 열어 자바스크립트 오류가 나는지 본다.  node tests/errors.js
   화면을 지우거나 합칠 때, 다른 파일이 지운 함수를 부르고 있으면 여기서 잡힌다. */
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const nm = p => path.join(ROOT, 'node_modules', p);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  let bad = 0;
  for (const [vn, W] of [['pc', 1280], ['phone', 390]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 }, isMobile: W < 600, hasTouch: W < 600 });
    await ctx.addInitScript(mock);
    await ctx.route('**/*', r => { const u = r.request().url();
      if (u.startsWith('https://app.test/')) { const f = path.join(ROOT, new URL(u).pathname.slice(1) || 'index.html'); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' }); }
      if (u.includes('chart.umd')) return r.fulfill({ path: nm('chart.js/dist/chart.umd.min.js'), contentType: 'application/javascript' });
      if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:(...a)=>window.__SB_MOD.createClient(...a)};' });
      return r.abort(); });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
    /* 폰은 기본이 앱 화면이라, 사이트 메뉴는 ?view=site 로 따로 연다 */
    await page.goto('https://app.test/index.html' + (W < 600 ? '?view=site' : '')); await page.waitForTimeout(1500);
    const subs = await page.evaluate(() => Object.entries(SECTION_SUBS).flatMap(([s, l]) => l.filter(x => x[0] !== '#').map(x => s + '/' + x[0])));
    for (const k of subs) {
      const n0 = errs.length;
      const [s, sub] = k.split('/');
      try { await page.evaluate(([s, sub]) => goTo(s, sub), [s, sub]); } catch (e) { errs.push(e.message.split('\n')[0]); }
      await page.waitForTimeout(300);
      /* 화면 안의 버튼(보기 전환)도 한 번씩 눌러 본다 */
      await page.evaluate(() => document.querySelectorAll('#page-content .range-toggle button, #page-content [data-view], #page-content [data-gf], #page-content [data-gd]').forEach((b, i) => { if (i < 12) try { b.click(); } catch (e) {} }));
      await page.waitForTimeout(200);
      if (errs.length > n0) { bad++; console.log(vn, k, '→', [...new Set(errs.slice(n0))].join(' | ').slice(0, 300)); }
    }
    if (W < 600) {
      /* 앱 화면: 탭바 · 하위 버튼 · 기록 고치기 시트 · 빠른 기록을 한 번씩 눌러 본다 */
      const pa = await ctx.newPage(); const ea = [];
      pa.on('pageerror', e => ea.push(e.message));
      pa.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) ea.push(m.text()); });
      await pa.goto('https://app.test/index.html'); await pa.waitForTimeout(1500);
      const click = async (sel) => { await pa.evaluate((q) => { const el = document.querySelector(q); if (!el) throw new Error('없음: ' + q); el.click(); }, sel).catch(e => ea.push(e.message.split('\n')[0])); await pa.waitForTimeout(250); };
      for (const t of ['list', 'cal', 'more']) {
        await click(`[data-go=${t}]`);
        const subs = await pa.evaluate(() => [...document.querySelectorAll('#ap-bar [data-sub]')].map(b => b.dataset.sub).filter(x => x !== 'm:site' && x !== 'm:out'));
        for (const sb of subs) await click(`#ap-bar [data-sub="${sb}"]`);
        await click('#ap-bar [data-act=back]');
      }
      await click('[data-go=home]');
      await click('.ap-tx'); await pa.waitForTimeout(300); await click('#ap-sheet [data-x]');
      await click('[data-act=add]'); await pa.waitForTimeout(300); await click('#qe-x');
      if (ea.length) { bad++; console.log(vn, 'app →', [...new Set(ea)].join(' | ').slice(0, 300)); }
      await pa.close();
    }
    for (const url of ['gagyebu.html', 'date/index.html']) {
      if (!fs.existsSync(path.join(ROOT, url))) continue;
      const p2 = await ctx.newPage(); const e2 = [];
      p2.on('pageerror', e => e2.push(e.message));
      await p2.goto('https://app.test/' + url); await p2.waitForTimeout(1200);
      if (e2.length) { bad++; console.log(vn, url, '→', e2.join(' | ').slice(0, 300)); }
      await p2.close();
    }
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `오류 난 화면 ${bad}곳` : '오류 없음');
  process.exit(bad ? 1 : 0);
})();
