/* ---------------- 화면 틀: 머리·메뉴·배너·페이지 전환 ---------------- */

function renderShell() {
  /* 폰이면 사이트 대신 앱 화면 (js/app/app.js) */
  if (apWanted()) { apShell(); return; }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="site-header" id="site-header">
      <div class="topbar">
        <div class="brand" id="brand-home" role="link" tabindex="0" title="홈으로">
          <span class="mark">🦦</span>
          <h1>해달</h1>
          <span class="tagline">당신의 자산관리 파트너</span>
        </div>
        <div class="sync-box">
          <button class="nav-act accent" id="entry-btn" title="가계부 기록 (N)">＋ 기록<kbd>N</kbd></button>
          <button class="hdr-btn hdr-app" id="app-view-btn" title="폰 앱 화면으로">앱 화면</button>
          <button class="hdr-btn" id="signout-btn">로그아웃</button>
        </div>
      </div>
      <div id="banner-slot"></div>
      <div class="navrow">
        <nav class="navbar" id="navbar"></nav>
      </div>
    </div>
    <div class="site-layout">
      <aside class="railnav" id="railnav"></aside>
      <div class="site-main">
        <div class="page-head" id="page-head"></div>
        <div id="page-content"></div>
        <div class="footer"></div>
      </div>
    </div>
  `;
  document.getElementById('entry-btn').addEventListener('click', () => (qeWanted() ? qeOpen() : enOpen()));
  /* 타이틀(아이콘·'해달')을 누르면 어디서든 홈으로 */
  const brand = document.getElementById('brand-home');
  const goHome = () => {
    const ov = document.getElementById('en-ov');
    if (ov && !ov.hidden) enClose();
    goTo('home', 'main');
  };
  brand.addEventListener('click', goHome);
  brand.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
  });
  document.getElementById('signout-btn').addEventListener('click', enSignOut);
  document.getElementById('app-view-btn').addEventListener('click', () => {
    try { localStorage.removeItem(AP_VIEW_KEY); } catch (e) {}
    location.href = location.pathname;
  });
  document.getElementById('navbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    goTo(btn.dataset.page, btn.dataset.sub);
  });
  document.getElementById('railnav').addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-btn');
    if (!btn) return;
    goTo(state.page, btn.dataset.sub);
  });
  renderNav();
  rcInit();
  enSyncHeaderOffset();
}

function renderBanner() {
  const slot = document.getElementById('banner-slot');
  if (!slot) return;
  if (!state.data && state.lastError) {
    slot.innerHTML = `
      <div class="banner err" style="align-items:flex-start;">
        <span>⚠ 데이터를 불러오지 못했어요. (${enEsc(state.lastError)})</span>
        <button class="btn small" id="retry-btn" style="margin-left:auto;flex-shrink:0;">다시 시도</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => fetchLive(true));
  } else if (state.source === 'live' && state.lastError) {
    slot.innerHTML = `
      <div class="banner" style="align-items:flex-start;">
        <span>ℹ️ ${state.lastError}</span>
        <button class="btn small" id="retry-btn" style="margin-left:auto;flex-shrink:0;">다시 시도</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => fetchLive(true));
  } else {
    slot.innerHTML = '';
  }
}

function destroyPageCharts() {
  Object.values(state.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
  state.charts = {};
}

/* 이번 달 자산 스냅샷이 아직 비어 있으면 알린다 — 탭의 빨간 점, 홈 '확인할 것', 폰 홈 배너가 모두 이 한 기준을 쓴다.
   스냅샷은 달 초에 '이번 달' 칸에 적는다(스냅샷 화면도 이번 달을 먼저 연다).
   달이 바뀌면(1일부터) 자동으로 켜지고, 그 달 값을 한 줄이라도 넣으면 사라진다. */
function snapNeedsInput(data) {
  const rows = ((data || state.data) && (data || state.data).assetRows) || [];
  if (!rows.length) return false;
  const now = new Date();
  const k = now.getFullYear() * 100 + (now.getMonth() + 1);
  return !rows.some(r => assetMonthKey(r.date) === k);
}
function navNeedsDot(section, sub) {
  return section === 'entry' && sub === 'snapshot' && snapNeedsInput();
}

function renderNav() {
  const bar = document.getElementById('navbar');
  if (!bar) return;
  /* 상단에는 최상위 개념만 둔다. 하위는 좌측 레일이 맡는다. */
  bar.innerHTML = NAV_ITEMS.map(n => {
    const on = n.id === state.page;
    const v = currentSub(n.id) || ((SECTION_SUBS[n.id] || []).filter(x => x[0] !== '#')[0] || ['main'])[0];
    return `<button class="nav-btn${on ? ' active' : ''}" data-page="${n.id}" data-sub="${v}">${n.label}${
      navSectionDot(n.id) ? '<span class="nav-dot" title="이번 달 자산 스냅샷이 아직 비어 있어요"></span>' : ''}</button>`;
  }).join('');
  renderSubNav();
}

/* 하위가 하나뿐인 섹션(홈·투자·목표)은 레일을 접어 본문을 넓게 쓴다. */
function renderSubNav() {
  const el = document.getElementById('railnav');
  if (!el) return;
  const n = NAV_ITEMS.find(x => x.id === state.page);
  const subs = SECTION_SUBS[state.page] || [];
  const layout = document.querySelector('.site-layout');
  if (!n || n.solo || subs.filter(x => x[0] !== '#').length < 2) {
    el.innerHTML = '';
    if (layout) layout.classList.add('no-rail');
    return;
  }
  if (layout) layout.classList.remove('no-rail');
  const cur = currentSub(state.page);
  /* ['#', '기간별'] 처럼 v 가 '#' 이면 항목이 아니라 묶음 제목이다. */
  el.innerHTML = subs.map(([v, l]) => v === '#'
    ? `<div class="sub-cat">${l}</div>`
    : `<button class="sub-btn${v === cur ? ' on' : ''}" data-sub="${v}">${l}${
        navNeedsDot(state.page, v) ? '<span class="nav-dot"></span>' : ''}</button>`).join('');
}

/* 섹션 버튼에 점을 찍을지 — 하위 중 하나라도 알림이 있으면 */
function navSectionDot(sec) {
  return (SECTION_SUBS[sec] || []).some(([v]) => v !== '#' && navNeedsDot(sec, v));
}

function renderPage() {
  if (AP.on) {
    /* 자산 스냅샷은 입력 중일 수 있으니 데이터가 새로 와도 다시 그리지 않는다 */
    if (AP.tab === 'more' && AP.sub === 'snap' && document.getElementById('ap-snap')) apPaintBarIfIdle();
    else apRender(false);
    return;
  }
  if (!state.data) {
    /* 첫 로딩이 끝나기 전(또는 실패)에는 옛 숫자 대신 빈 자리만 보여준다 */
    const body0 = document.getElementById('page-content');
    renderNav();
    if (body0) body0.innerHTML = state.lastError
      ? '<div class="empty-state" style="padding:48px 0;text-align:center;opacity:.7;">데이터를 불러오지 못했어요. 위의 ‘다시 시도’를 눌러 주세요.</div>'
      : '<div class="empty-state" style="padding:48px 0;text-align:center;opacity:.7;">불러오는 중…</div>';
    return;
  }
  const _now = new Date();
  const _nowKey = _now.getFullYear() * 100 + (_now.getMonth() + 1);
  const raw = state.data;
  /* 미래(오늘 이후) 자산 스냅샷 행은 화면 전체에서 제외 */
  const data = { ...raw, assetRows: (raw.assetRows || []).filter(r => assetMonthKey(r.date) <= _nowKey) };
  const d = computeDerived(data);
  destroyPageCharts();
  const body = document.getElementById('page-content');
  const section = NAV_ITEMS.some(n => n.id === state.page) ? state.page : 'home';
  state.page = section;
  const SUB = currentSub(section);
  routeWrite(section, SUB);
  renderNav();
  body.innerHTML = '';

  /* 하위로 들어왔으면 어디인지 한 줄로 알려준다. 상단 메뉴만으로는 모른다.
     각 렌더러가 page-content 를 통째로 덮어쓰므로 제목은 그 바깥에 둔다. */
  const head = document.getElementById('page-head');
  if (head) {
    const subsAll = SECTION_SUBS[section] || [];
    const label = (subsAll.find(x => x[0] === SUB) || [])[1];
    const nItem = NAV_ITEMS.find(x => x.id === section);
    /* 화면 스스로 기간(연도·연도/월)을 크게 띄우는 곳은 제목을 겹쳐 달지 않는다 */
    const selfTitled = section === 'report' && (SUB === 'monthly' || SUB === 'yearly');
    const show = label && !selfTitled && !(nItem && nItem.solo) && subsAll.filter(x => x[0] !== '#').length > 1;
    head.textContent = show ? label : '';
    head.hidden = !show;
  }

  if (section === 'home') {
    renderHomePage(body, data, d);

  } else if (section === 'entry') {
    if (SUB === 'snapshot') renderSnapshotPage(body);
    else if (SUB === 'calendar') renderEntryPane(body, data, d, 'calendar');
    else renderEntryPane(body, data, d, 'list');

  } else if (section === 'invest') {
    renderInvestmentPage(body, data, d);

  } else if (section === 'goals') {
    body.innerHTML = '<div id="home-goals"></div>';
    renderGoalBoard(data, d, SUB);

  } else if (section === 'report') {
    if (SUB === 'yearly') renderYearPage(body, data, d);
    else if (SUB === 'networth') renderAssetsPage(body, data, d);
    else renderNowPage(body, data, d);

  } else {
    if (SUB === 'budget') renderBudgetSettings(body, data, d);
    else if (SUB === 'saving') renderSavingPlanSettings(body, data, d);
    else dbmRenderFor(body, SUB);
  }
}

/* 입출금 — 목록과 캘린더는 좌측 메뉴로 갈린다. 기록 버튼만 공통으로 얹는다. */
function renderEntryPane(body, data, d, view) {
  body.innerHTML = '<div id="entry-body"></div>';
  const host = document.getElementById('entry-body');
  if (view === 'calendar') renderCalendarPage(host, data, d);
  else renderLedgerShell(host);
}
