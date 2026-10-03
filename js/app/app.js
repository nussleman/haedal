/* ================= 폰 앱 =================
   폰(좁은 화면)으로 열면 사이트 대신 이 화면이 뜬다. 앱은 거의 '기록용'이다.
     1) 기록을 빠르게 넣고 고치는 것  2) 이번 달 기본 지표만 확인하는 것
   아래 떠 있는 탭바: 홈 · 내역 · ＋기록 · 달력 · 더보기
   내역·달력·더보기를 누르면 탭바가 그 화면의 하위 버튼으로 바뀌고, ← 로 기본 탭바에 돌아온다.
   PC 화면이 필요하면 더보기 › PC 화면 (주소에 ?view=site 를 붙여도 된다). */

const AP_VIEW_KEY = 'haedal:view';
const AP = {
  on: false,
  tab: 'home',        /* home · list · cal · more */
  bar: null,          /* null = 기본 탭바, 아니면 하위 버튼을 띄운 탭 */
  kind: 'all',        /* 내역 필터: all · 지출 · 수입 · 이체 */
  listMonth: null,
  calMonth: null,
  calDay: null,
  sub: null,          /* 더보기 안의 화면: null · 'snap' */
  anim: false
};

/* 폰이면 앱. ?view=site 로 열었거나 'PC 화면'을 골랐으면 사이트 */
function apWanted() {
  try {
    const q = new URLSearchParams(location.search).get('view');
    if (q === 'site') return false;
    if (q === 'app') return true;
    if (localStorage.getItem(AP_VIEW_KEY) === 'site') return false;
  } catch (e) {}
  return window.matchMedia('(max-width: 640px)').matches;
}
function apOn() { return AP.on; }

const AP_IC = {
  home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 7h11M8 12h11M8 17h11"/><circle cx="4.5" cy="7" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="17" r=".8"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
  prev: '<path d="M14.5 6 8.5 12l6 6"/>',
  next: '<path d="M9.5 6l6 6-6 6"/>'
};
const apIcon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${AP_IC[k] || ''}</svg>`;

/* 기본 탭바 */
const AP_TABS = [['home', '홈'], ['list', '내역'], ['add', '기록'], ['cal', '달력'], ['more', '더보기']];
/* 하위 버튼 — 탭을 누르면 탭바가 이걸로 바뀐다 */
function apSubItems(tab) {
  if (tab === 'list') return [['f:all', '전체'], ['f:지출', '지출'], ['f:수입', '수입'], ['f:이체', '이체']];
  if (tab === 'cal') {
    const mk = AP.calMonth || thisMonthKey();
    const mo = (k) => Number(k.split('-')[1]) + '월';
    return [['c:-1', '‹ ' + mo(shiftMonthKey(mk, -1))], ['c:0', '이번 달'], ['c:1', mo(shiftMonthKey(mk, 1)) + ' ›']];
  }
  if (tab === 'more') return [['m:snap', '자산 스냅샷'], ['m:site', 'PC 화면'], ['m:out', '로그아웃']];
  return [];
}
const AP_TITLE = { home: '해달', list: '내역', cal: '달력', more: '더보기' };

/* ---------------- 틀 ---------------- */
function apShell() {
  AP.on = true;
  /* 앱처럼: 두 번 톡톡·핀치로 화면이 커지지 않게 */
  document.documentElement.classList.add('ap-app');
  const vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.body.classList.add('ap-on');
  const app = document.getElementById('app');
  app.innerHTML = `
    <header class="ap-top">
      <span class="ap-mark" aria-hidden="true">🦦</span>
      <b id="ap-title">해달</b>
      <button class="ap-sync" id="ap-sync" title="새로고침"><i class="sync-dot" id="sync-dot"></i><span id="sync-label"></span></button>
    </header>
    <div id="banner-slot"></div>
    <main class="ap-main" id="ap-main"></main>
    <nav class="ap-bar" id="ap-bar" aria-label="메뉴"></nav>`;
  document.getElementById('ap-sync').addEventListener('click', () => fetchLive(true, Promise.resolve()));
  document.getElementById('ap-bar').addEventListener('click', apBarClick);
  document.getElementById('ap-main').addEventListener('click', apMainClick);
  apPaintBar();
  /* 기록 화면에 쓸 사용처·분류를 미리 받아 둔다 */
  qeLoad().catch(() => {});
}

/* 기록 화면이 열리고 닫힐 때 — 탭바는 그대로 두고 ＋ 만 켜 둔다 */
function apQeChanged() {
  if (!AP.on) return;
  if (QE.open) AP.bar = null;
  /* 기록 화면이 떠 있는 동안 탭바를 그 안으로 옮긴다 — 기록 화면(보이는 영역 기준) 맨 아래에 정확히 붙게 */
  const bar = document.getElementById('ap-bar');
  const qe = document.getElementById('qe');
  if (bar) {
    if (QE.open && qe) { if (bar.parentNode !== qe) qe.appendChild(bar); }
    else if (bar.parentNode !== document.getElementById('app')) document.getElementById('app').appendChild(bar);
  }
  apPaintBar();
}

function apPaintBar() {
  const bar = document.getElementById('ap-bar');
  if (!bar) return;
  let html;
  if (!AP.bar) {
    html = AP_TABS.map(([k, l]) => k === 'add'
      ? `<button class="ap-add${QE.open ? ' on' : ''}" data-act="add" aria-label="기록하기">${apIcon('add')}</button>`
      : `<button class="ap-tb${AP.tab === k && !QE.open ? ' on' : ''}" data-go="${k}">${apIcon(k)}<span>${l}</span></button>`).join('');
  } else {
    const cur = AP.bar === 'list' ? 'f:' + AP.kind : AP.bar === 'more' && AP.sub ? 'm:' + AP.sub
      : AP.bar === 'cal' && (AP.calMonth || thisMonthKey()) === thisMonthKey() ? 'c:0' : '';
    html = `<button class="ap-back" data-act="back" aria-label="기본 메뉴로">${apIcon('back')}</button>`
      + apSubItems(AP.bar).map(([k, l, ic]) => `<button class="ap-sb${k === cur ? ' on' : ''}${ic ? ' ic' : ''}" data-sub="${k}" aria-label="${l}">${ic ? apIcon(ic) : l}</button>`).join('');
  }
  bar.classList.toggle('sub', !!AP.bar);
  bar.innerHTML = `<div class="ap-bar-in${AP.anim ? ' swap' : ''}">${html}</div>`;
  AP.anim = false;
}

function apBarClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'add') { qeOpen(); return; }
  if (b.dataset.act === 'back') { AP.bar = null; AP.anim = true; apPaintBar(); return; }
  if (b.dataset.go) {
    const t = b.dataset.go;
    /* 기록 중에 다른 탭을 누르면 기록 화면을 닫고 그 탭으로 */
    if (QE.open) qeClose();
    const changed = AP.tab !== t;
    AP.tab = t;
    if (t === 'more') AP.sub = null;
    if (t !== 'home') { AP.bar = t; AP.anim = true; }
    apPaintBar();
    apRender(changed);
    return;
  }
  const s = b.dataset.sub;
  if (!s) return;
  const [kind, v] = s.split(':');
  if (kind === 'f') { AP.kind = v; apPaintBar(); apRender(false); }
  else if (kind === 'c') {
    AP.calMonth = v === '0' ? thisMonthKey() : shiftMonthKey(AP.calMonth || thisMonthKey(), Number(v));
    AP.calDay = AP.calMonth === thisMonthKey() ? todayDayKey() : null;
    apPaintBar();
    apRender(false);
  } else if (kind === 'm') {
    if (v === 'snap') { AP.sub = 'snap'; apPaintBar(); apRender(true); }
    else if (v === 'site') {
      try { localStorage.setItem(AP_VIEW_KEY, 'site'); } catch (e) {}
      location.href = location.pathname + '#home/main';
      location.reload();
    } else if (v === 'out') { if (confirm('로그아웃할까요?')) enSignOut(); }
  }
}

/* 본문 안 버튼들 */
function apMainClick(e) {
  const row = e.target.closest('[data-tx]');
  if (row) { apEdit(Number(row.dataset.tx)); return; }
  const b = e.target.closest('[data-ap]');
  if (!b) return;
  const a = b.dataset.ap;
  if (a === 'list') { AP.tab = 'list'; AP.bar = 'list'; AP.anim = true; apPaintBar(); apRender(true); }
  else if (a === 'snap') { AP.tab = 'more'; AP.sub = 'snap'; AP.bar = 'more'; AP.anim = true; apPaintBar(); apRender(true); }
  else if (a === 'add') qeOpen();
  else if (a === 'lm') { AP.listMonth = shiftMonthKey(AP.listMonth || thisMonthKey(), Number(b.dataset.d)); apRender(false); }
  else if (a === 'day') { AP.calDay = b.dataset.k; apRender(false); }
}

/* renderPage 가 앱 모드일 때 대신 부른다 */
function apRender(toTop) {
  const main = document.getElementById('ap-main');
  if (!main) return;
  const t = document.getElementById('ap-title');
  if (t) t.textContent = AP.tab === 'more' && AP.sub === 'snap' ? '자산 스냅샷' : AP_TITLE[AP.tab];
  apPaintBarIfIdle();
  if (!state.data) {
    main.innerHTML = `<div class="ap-empty">${state.lastError ? '데이터를 불러오지 못했어요. 위의 ‘다시 시도’를 눌러 주세요.' : '불러오는 중…'}</div>`;
    return;
  }
  destroyPageCharts();
  const data = state.data;
  if (AP.tab === 'list') apListPage(main, data);
  else if (AP.tab === 'cal') apCalPage(main, data);
  else if (AP.tab === 'more') apMorePage(main, data);
  else apHomePage(main, data);
  if (toTop) window.scrollTo(0, 0);
}
/* 데이터가 새로 와서 다시 그릴 때 탭바 점(스냅샷 알림)도 맞춘다 — 애니메이션 없이 */
function apPaintBarIfIdle() {
  const bar = document.getElementById('ap-bar');
  if (bar && !bar.querySelector('.swap')) apPaintBar();
}

/* ---------------- 공용 ---------------- */
const apKind = (r) => String(r.major || '').includes('수입') ? '수입' : String(r.major || '').includes('지출') ? '지출' : '이체';
const apWon = (n) => wonComma(n) + '원';
function apMonthRows(ledger, mk) { return ledger.filter(r => (r.dayKey || '').slice(0, 7) === mk); }
function apSum(rows, kind) {
  return rows.filter(r => apKind(r) === kind).reduce((a, r) => a + (kind === '지출' ? netExpenseOf(r) : r.amount), 0);
}
function apDayLabel(k) {
  const t = todayDayKey();
  if (k === t) return '오늘';
  if (k === shiftDayKey(t, -1)) return '어제';
  const [, m, d] = k.split('-').map(Number);
  return `${m}월 ${d}일`;
}

function apRow(r) {
  const k = apKind(r);
  const title = r.vendor || r.item || r.minor || '-';
  const sub = [[r.minor, r.item].filter(Boolean).join(' › '), r.memo].filter(Boolean).join(' · ');
  const marks = [r.fixed ? '고정' : '', r.refund ? '회사' : '', r.good ? 'GOOD' : '', r.regret ? 'BAD' : ''].filter(Boolean);
  return `<button class="ap-tx" data-tx="${r.id}">
    <span class="e" aria-hidden="true">${r.emoji || (k === '수입' ? '💰' : k === '이체' ? '🔁' : '•')}</span>
    <span class="t"><b>${enEsc(title)}</b><small>${enEsc(sub)}${marks.length ? ` <i>${marks.join(' ')}</i>` : ''}</small></span>
    <span class="v k-${k}">${k === '수입' ? '+' : ''}${wonComma(r.amount)}</span>
  </button>`;
}

/* 날짜별로 묶은 목록 */
function apDayGroups(rows) {
  const groups = [];
  const idx = {};
  rows.forEach(r => {
    const k = r.dayKey;
    if (idx[k] === undefined) { idx[k] = groups.length; groups.push({ k, items: [] }); }
    groups[idx[k]].items.push(r);
  });
  return groups.map(g => {
    const out = apSum(g.items, '지출');
    const dt = new Date(g.k + 'T00:00:00');
    return `<section class="ap-day">
      <div class="ap-dh"><b>${apDayLabel(g.k)}</b><span>${EN_WD[dt.getDay()]}</span>
        <em>${out ? '−' + wonComma(out) : ''}</em></div>
      <div class="ap-card">${g.items.map(apRow).join('')}</div>
    </section>`;
  }).join('');
}
const apSortDesc = (a, b) => (b.dayKey || '').localeCompare(a.dayKey || '') || (b.id || 0) - (a.id || 0);

/* ---------------- 홈: 기본 지표만 ---------------- */
function apHomePage(main, data) {
  const ledger = data.ledger || [];
  const mk = thisMonthKey();
  const now = new Date();
  const today = todayDayKey();
  const cur = apMonthRows(ledger, mk);
  const out = apSum(cur, '지출');
  const inc = apSum(cur, '수입');
  const days = daysInMonthKey(mk);
  const daysLeft = days - now.getDate() + 1;
  /* 남은 예산 = 변동 예산 − 변동 지출 (📌 고정 예산은 따로 센다 — home.js budgetSplit) */
  const bs = budgetSplit(data, cur.filter(r => apKind(r) === '지출'));
  const hasBudget = bs.has;
  const budget = bs.varBudget;
  const left = bs.left;
  const perDay = left > 0 ? left / daysLeft : 0;
  const usedPct = budget > 0 ? Math.min(100, (bs.varSpent / budget) * 100) : 0;
  const dayPct = (now.getDate() / days) * 100;
  const over = budget > 0 && bs.varSpent > budget * dayPct / 100;
  /* 이번 주 = 월요일부터 */
  const wk = shiftDayKey(today, -((now.getDay() + 6) % 7));
  const todayOut = apSum(ledger.filter(r => r.dayKey === today), '지출');
  const weekOut = apSum(ledger.filter(r => r.dayKey >= wk && r.dayKey <= today), '지출');
  const rate = inc > 0 ? ((inc - out) / inc) * 100 : null;

  /* 순자산 — 마지막 자산 스냅샷 기준 */
  const d = computeDerived({ ...data, assetRows: (data.assetRows || []).filter(r => assetMonthKey(r.date) <= now.getFullYear() * 100 + now.getMonth() + 1) });
  /* 이번 달 자산 스냅샷을 아직 안 적었으면(1일부터 적을 때까지) 홈 맨 위에서 알려 준다 */
  const needSnap = snapNeedsInput(data);

  const recent = [...ledger].filter(r => r.dayKey <= today).sort(apSortDesc).slice(0, 6);

  main.innerHTML = `
    ${needSnap ? `<button class="ap-nudge" data-ap="snap"><b>${now.getMonth() + 1}월 자산 스냅샷을 아직 안 적었어요</b><span>계좌 잔액 적기 ›</span></button>` : ''}
    <section class="ap-hero">
      <div class="ap-hl">${now.getMonth() + 1}월 남은 예산 <span>${daysLeft}일 남음</span></div>
      <div class="ap-big mono ${left < 0 ? 'neg' : ''}">${left < 0 ? '−' : ''}${wonComma(Math.abs(left))}<small>원</small></div>
      ${budget > 0 ? `<div class="ap-prog"><i class="${over ? 'over' : ''}" style="width:${usedPct}%"></i><em style="left:${dayPct}%"></em></div>` : ''}
      <div class="ap-hs"><span>하루 <b class="mono">${left > 0 ? apWon(Math.round(perDay)) : '0원'}</b></span>
        <span>${bs.fixedBudget > 0 ? `📌 고정 ${formatKrw(bs.fixedSpent)}/${formatKrw(bs.fixedBudget)}` : `예산 ${formatKrw(budget)}${hasBudget ? '' : ' (평균)'}`}</span></div>
    </section>
    <div class="ap-tiles">
      <div class="ap-tile"><span>오늘 쓴 돈</span><b class="mono">${formatKrw(todayOut)}</b></div>
      <div class="ap-tile"><span>이번 주</span><b class="mono">${formatKrw(weekOut)}</b></div>
      <div class="ap-tile"><span>이번 달 지출</span><b class="mono out">${formatKrw(out)}</b></div>
      <div class="ap-tile"><span>이번 달 수입</span><b class="mono in">${formatKrw(inc)}</b></div>
      <div class="ap-tile"><span>저축률</span><b class="mono">${rate === null ? '—' : rate.toFixed(0) + '%'}</b></div>
      <button class="ap-tile" data-ap="snap"><span>순자산${d.latestMonth ? ` <i>${enEsc(assetMonthLabel(d.latestMonth))}</i>` : ''}</span>
        <b class="mono">${d.totalAssets ? formatKrw(d.totalAssets) : '—'}</b>
        ${d.deltaAssets != null ? `<small class="${d.deltaAssets >= 0 ? 'up' : 'dn'}">${d.deltaAssets >= 0 ? '+' : '−'}${formatKrw(Math.abs(d.deltaAssets))}</small>` : ''}</button>
    </div>
    <div class="ap-sh"><b>최근 기록</b><button data-ap="list">전체 ›</button></div>
    ${recent.length ? `<div class="ap-card">${recent.map(r => apRow(r).replace('<span class="t">',
        `<span class="t"><em class="dl">${apDayLabel(r.dayKey)}</em>`)).join('')}</div>`
      : `<div class="ap-empty">아직 기록이 없어요.<br><button class="ap-cta" data-ap="add">첫 기록 남기기</button></div>`}`;
}

/* ---------------- 내역 ---------------- */
function apListPage(main, data) {
  const mk = AP.listMonth || (AP.listMonth = thisMonthKey());
  const rows = apMonthRows(data.ledger || [], mk).sort(apSortDesc);
  const shown = AP.kind === 'all' ? rows : rows.filter(r => apKind(r) === AP.kind);
  const isNow = mk === thisMonthKey();
  main.innerHTML = `
    <div class="ap-mnav">
      <button data-ap="lm" data-d="-1" aria-label="이전 달">${apIcon('prev')}</button>
      <b>${monthKeyLabel(mk)}</b>
      <button data-ap="lm" data-d="1" aria-label="다음 달" ${isNow ? 'disabled' : ''}>${apIcon('next')}</button>
    </div>
    <div class="ap-sum3">
      <div><span>지출</span><b class="mono out">${formatKrw(apSum(rows, '지출'))}</b></div>
      <div><span>수입</span><b class="mono in">${formatKrw(apSum(rows, '수입'))}</b></div>
      <div><span>이체</span><b class="mono tr">${formatKrw(apSum(rows, '이체'))}</b></div>
    </div>
    ${shown.length ? apDayGroups(shown) : `<div class="ap-empty">${AP.kind === 'all' ? '' : AP.kind + ' '}기록이 없어요.</div>`}`;
}

/* ---------------- 달력 ---------------- */
function apCalPage(main, data) {
  const mk = AP.calMonth || (AP.calMonth = thisMonthKey());
  if (AP.calDay === null && mk === thisMonthKey()) AP.calDay = todayDayKey();
  const rows = apMonthRows(data.ledger || [], mk);
  const byDay = {};
  rows.forEach(r => {
    if (apKind(r) !== '지출') return;
    byDay[r.dayKey] = (byDay[r.dayKey] || 0) + netExpenseOf(r);
  });
  const [y, m] = mk.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const n = daysInMonthKey(mk);
  const today = todayDayKey();
  const max = Math.max(1, ...Object.values(byDay));
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<span class="ap-cd blank"></span>';
  for (let dd = 1; dd <= n; dd++) {
    const k = `${mk}-${String(dd).padStart(2, '0')}`;
    const v = byDay[k] || 0;
    const wd = (first + dd - 1) % 7;
    cells += `<button class="ap-cd${k === today ? ' today' : ''}${k === AP.calDay ? ' sel' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-ap="day" data-k="${k}">
      <span class="n">${dd}</span>${v ? `<span class="s mono" style="--a:${(0.25 + 0.75 * v / max).toFixed(2)}">${formatCompactWon(v)}</span>` : ''}</button>`;
  }
  const dayRows = AP.calDay && AP.calDay.slice(0, 7) === mk ? rows.filter(r => r.dayKey === AP.calDay).sort(apSortDesc) : [];
  main.innerHTML = `
    <div class="ap-mnav solo"><b>${monthKeyLabel(mk)}</b><span>지출 ${formatKrw(apSum(rows, '지출'))}</span></div>
    <div class="ap-cal">
      ${EN_WD.map((w, i) => `<span class="ap-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</span>`).join('')}
      ${cells}
    </div>
    ${AP.calDay && AP.calDay.slice(0, 7) === mk
      ? (dayRows.length ? apDayGroups(dayRows) : `<div class="ap-empty">${apDayLabel(AP.calDay)}은 기록이 없어요.</div>`)
      : '<div class="ap-empty">날짜를 누르면 그날 기록이 보여요.</div>'}`;
}

/* ---------------- 더보기 ---------------- */
function apMorePage(main, data) {
  if (AP.sub === 'snap') {
    main.innerHTML = '<div id="ap-snap" class="ap-snap"></div>';
    renderSnapshotPage(document.getElementById('ap-snap'));
    return;
  }
  const now = new Date();
  const thisNum = now.getFullYear() * 100 + now.getMonth() + 1;
  const snapDone = (data.assetRows || []).some(r => assetMonthKey(String(r.date || '')) === thisNum);
  const n = (data.ledger || []).length;
  main.innerHTML = `
    <div class="ap-menu">
      <button data-ap="snap"><b>자산 스냅샷</b><span>계좌마다 이번 달 잔액 적기${snapDone ? '' : ' · <i>이번 달 아직</i>'}</span></button>
    </div>
    <p class="ap-foot">기록 ${wonComma(n)}건 · ${state.lastSync ? state.lastSync.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 갱신' : '저장된 값 표시 중'}<br>
      리포트·목표·투자는 PC 화면에서 보세요.</p>`;
}

/* ---------------- 기록 고치기 (아래에서 올라오는 시트) ---------------- */
async function apEdit(id) {
  const r = ((state.data && state.data.ledger) || []).find(x => x.id === id);
  if (!r) return;
  let sh = document.getElementById('ap-sheet');
  if (!sh) { sh = document.createElement('div'); sh.id = 'ap-sheet'; document.body.appendChild(sh); }
  sh.innerHTML = `<div class="ap-scrim" data-x></div><div class="ap-sheet-in"><div class="ap-empty">불러오는 중…</div></div>`;
  sh.hidden = false;
  document.body.classList.add('ap-sheet-on');
  qeLockSync();
  qeFitViewport();
  requestAnimationFrame(() => sh.classList.add('on'));
  sh.querySelector('[data-x]').addEventListener('click', apEditClose);
  try { await enEnsureRefs(); } catch (e) {}
  const cats = (EN.cats || []).slice();
  if (r.catId && !cats.some(c => c.id === r.catId)) cats.unshift({ id: r.catId, kind: r.major, category: r.minor, subcategory: r.item });
  const groups = {};
  cats.forEach(c => { const g = `${c.kind} · ${c.category}`; (groups[g] = groups[g] || []).push(c); });
  const f = { good: r.good ? 'Good' : r.regret ? 'Bad' : null, co: !!r.refund };
  const neg = r.amount < 0;
  sh.querySelector('.ap-sheet-in').innerHTML = `
    <div class="ap-grab"></div>
    <div class="ap-sht"><b>기록 고치기</b><button data-x class="ap-shx">닫기</button></div>
    <label class="ap-fl"><span>금액</span><input id="ap-e-amt" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" class="mono" value="${wonComma(Math.abs(r.amount))}"></label>
    <label class="ap-fl"><span>사용처</span><input id="ap-e-mer" value="${enEsc(r.merch || '')}" autocomplete="off" autocorrect="off" autocapitalize="off" enterkeyhint="done"></label>
    <label class="ap-fl"><span>분류</span><select id="ap-e-cat">${Object.entries(groups).map(([g, list]) =>
      `<optgroup label="${enEsc(g)}">${list.map(c => `<option value="${c.id}"${c.id === r.catId ? ' selected' : ''}>${enEsc(c.subcategory || c.category)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <label class="ap-fl"><span>날짜</span><input id="ap-e-date" type="date" value="${r.dayKey}"></label>
    <label class="ap-fl"><span>메모</span><input id="ap-e-note" value="${enEsc(r.memo || '')}" placeholder="없음" enterkeyhint="done"></label>
    <div class="ap-chips">
      <button data-t="neg" class="${neg ? 'on' : ''}">환불(−)</button>
      <button data-t="co" class="${f.co ? 'on' : ''}">회사</button>
      <button data-t="Good" class="${f.good === 'Good' ? 'on' : ''}">좋은</button>
      <button data-t="Bad" class="${f.good === 'Bad' ? 'on' : ''}">아쉬운</button>
    </div>
    <p class="ap-err" id="ap-e-err"></p>
    <div class="ap-acts"><button class="ap-del" id="ap-e-del">삭제</button><button class="ap-save" id="ap-e-save">저장</button></div>`;
  sh.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', apEditClose));
  /* 키보드의 '완료'는 키보드만 내린다 */
  sh.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); inp.blur(); }
  }));
  /* 저장·삭제를 누르는 순간 키보드가 내려가며 버튼이 밀리지 않게 */
  sh.querySelectorAll('.ap-acts button').forEach(b => b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); }));
  const amt = sh.querySelector('#ap-e-amt');
  amt.addEventListener('input', () => {
    const v = amt.value.replace(/[^\d]/g, '');
    amt.value = v ? Number(v).toLocaleString('ko-KR') : '';
  });
  let isNeg = neg;
  sh.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'neg') isNeg = !isNeg;
    else if (t === 'co') f.co = !f.co;
    else f.good = f.good === t ? null : t;
    sh.querySelectorAll('[data-t]').forEach(x => {
      const k = x.dataset.t;
      x.classList.toggle('on', k === 'neg' ? isNeg : k === 'co' ? f.co : f.good === k);
    });
  }));
  sh.querySelector('#ap-e-save').addEventListener('click', async (ev) => {
    const n = Number(amt.value.replace(/[^\d]/g, ''));
    const err = sh.querySelector('#ap-e-err');
    if (!n) { err.textContent = '금액을 넣으세요.'; return; }
    const catId = Number(sh.querySelector('#ap-e-cat').value) || null;
    const nm = sh.querySelector('#ap-e-mer').value.trim();
    const patch = {
      amount: isNeg ? -n : n, category_id: catId, date: sh.querySelector('#ap-e-date').value || r.dayKey,
      merchant: nm || null, merchant_group: nm === (r.merch || '') ? (r.mgroup || null) : ((EN.merchGroup || {})[nm] || null),
      note: sh.querySelector('#ap-e-note').value.trim() || null,
      good_bad: f.good, company_paid: f.co
    };
    ev.target.disabled = true; ev.target.textContent = '저장 중…';
    try {
      const { error } = await (await enClient()).from('transactions').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
      apApplyLocal(r, patch);
      enToast('고쳤습니다');
      apEditClose();
      apRender(false);
      lgTouched();
    } catch (e) {
      err.textContent = '저장하지 못했습니다 — ' + (e.message || e);
      ev.target.disabled = false; ev.target.textContent = '저장';
    }
  });
  sh.querySelector('#ap-e-del').addEventListener('click', async () => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      const { error } = await (await enClient()).from('transactions').delete().eq('id', id);
      if (error) throw new Error(error.message);
      state.data.ledger = state.data.ledger.filter(x => x.id !== id);
      enToast('삭제했습니다');
      apEditClose();
      apRender(false);
      lgTouched();
    } catch (e) {
      sh.querySelector('#ap-e-err').textContent = '삭제하지 못했습니다 — ' + (e.message || e);
    }
  });
}

/* 서버에서 다시 읽어 오기 전에 화면부터 바로 맞춘다 */
function apApplyLocal(r, p) {
  const c = (EN.catById || {})[p.category_id];
  const [y, mo, d] = String(p.date).split('-');
  Object.assign(r, {
    amount: p.amount, catId: p.category_id, dayKey: p.date, date: `${y}. ${Number(mo)}. ${Number(d)}`,
    merch: p.merchant || '', vendor: p.merchant || p.merchant_group || '', mgroup: p.merchant_group || '',
    memo: p.note || '', good: p.good_bad === 'Good', regret: p.good_bad === 'Bad',
    refund: p.company_paid ? p.amount : 0
  });
  if (c) Object.assign(r, { major: c.kind, minor: c.category, item: c.subcategory, emoji: c.emoji_category || r.emoji });
}

function apEditClose() {
  const sh = document.getElementById('ap-sheet');
  if (!sh) return;
  sh.classList.remove('on');
  if (document.activeElement && sh.contains(document.activeElement)) document.activeElement.blur();
  document.body.classList.remove('ap-sheet-on');
  qeLockSync();
  setTimeout(() => { if (!sh.classList.contains('on')) { sh.hidden = true; sh.innerHTML = ''; } }, 220);
}
