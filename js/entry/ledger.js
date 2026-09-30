/* ================= 전체 내역 (현황 › 전체 내역) ================= */
function enQuickRange(key) {
  const now = new Date();
  const p = (d) => { d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const y = now.getFullYear(), m = now.getMonth();
  if (key === 'tm') return [p(new Date(y, m, 1)), p(new Date(y, m + 1, 0))];
  if (key === 'lm') return [p(new Date(y, m - 1, 1)), p(new Date(y, m, 0))];
  if (key === '3m') return [p(new Date(y, m - 2, 1)), p(new Date(y, m + 1, 0))];
  if (key === 'ty') return [p(new Date(y, 0, 1)), p(new Date(y, 11, 31))];
  return ['', ''];
}

/* ---------------- 내역 고정줄 ----------------
   position:sticky 로는 이 화면에서 두 가지가 계속 말썽이었다.
   (1) top 값이 제자리보다 크면 요소가 아래로 밀려 위에 빈 칸이 생기고 맨 위 행을 덮었다.
   (2) 스크롤을 내려도 붙지 않고 그대로 올라가 버렸다.
   그래서 sticky 를 쓰지 않고 직접 계산해 고정한다 — 제자리가 머리줄 밑으로 파고드는 순간
   position:fixed 로 바꿔 머리줄 바로 아래에 붙이고, 빠진 자리는 같은 높이의 빈 칸으로 메운다.
   '제자리'는 언제나 그 빈 칸이 알려주므로 값이 어긋날 여지가 없다. */
function lgSyncStickTop() {
  const stick = document.querySelector('.lg-wrap .lg-stick');
  const hdr = document.querySelector('.site-header');
  /* 머리줄 높이는 어느 화면이든 재 둔다 — 사용처 화면의 고정줄도 이 값을 쓴다.
     예전엔 아래에서 잰 탓에, 사용처 화면에서는 값이 낡거나 0으로 남아
     고정줄이 머리줄 뒤로 파고들고 그 틈으로 행이 지나가 보였다. */
  let h = hdr ? Math.round(hdr.getBoundingClientRect().height) : 0;
  if (!(h > 0 && h < 500)) h = 0;
  document.documentElement.style.setProperty('--hdr-h', h + 'px');

  if (!stick || stick.classList.contains('mg-stick')) return;   // 사용처 관리 화면은 직접 고정하지 않는다
  const wrap = stick.closest('.lg-wrap');
  if (!wrap || !hdr) return;

  let sp = wrap.querySelector('.lg-stick-hole');
  if (!sp) {
    sp = document.createElement('div');
    sp.className = 'lg-stick-hole';
    sp.style.display = 'none';
    wrap.insertBefore(sp, stick);
  }

  /* 머리줄과 필터 사이의 숨 쉴 틈(본문 위 여백)도 고정 대상이다. 그만큼 고정줄 위에
     덧대 두지 않으면, 붙는 순간 그 틈으로 행이 지나가 보이고 필터도 위로 튄다. */
  const pc = document.getElementById('page-content');
  let gap = pc ? parseFloat(getComputedStyle(pc).paddingTop) : 0;
  gap = (gap >= 0 && gap < 60) ? Math.round(gap) : 0;

  const on = stick.classList.contains('lg-fixed');
  const home = (on ? sp : stick).getBoundingClientRect().top;   // 고정 안 했을 때의 자리
  const box = wrap.getBoundingClientRect();

  if (home <= h && box.bottom > h + 60) {
    const hgt = Math.round(stick.getBoundingClientRect().height) - (on ? gap : 0);
    if (sp.style.display === 'none') sp.style.display = 'block';
    if (sp.dataset.h !== String(hgt)) { sp.dataset.h = String(hgt); sp.style.height = hgt + 'px'; }
    stick.classList.add('lg-fixed');
    stick.style.position = 'fixed';
    stick.style.top = h + 'px';
    stick.style.left = Math.round(box.left) + 'px';
    stick.style.width = Math.round(box.width) + 'px';
    stick.style.paddingTop = (gap + 4) + 'px';                  // 4px 는 원래 고정줄 위 여백
  } else if (on) {
    stick.classList.remove('lg-fixed');
    stick.style.position = '';
    stick.style.top = '';
    stick.style.left = '';
    stick.style.width = '';
    stick.style.paddingTop = '';
    sp.style.display = 'none';
    sp.dataset.h = '';
  }
}
function lgBindStickTop() {
  lgSyncStickTop();
  requestAnimationFrame(lgSyncStickTop);
  setTimeout(lgSyncStickTop, 300);
  setTimeout(lgSyncStickTop, 1200);
  const tick = () => requestAnimationFrame(lgSyncStickTop);
  /* 머리줄 element 가 다시 그려졌을 수 있으니 감시자는 매번 다시 건다. */
  const hdr = document.querySelector('.site-header');
  const stick = document.querySelector('.lg-wrap .lg-stick');
  if (window.ResizeObserver) {
    if (!lgBindStickTop._ro) lgBindStickTop._ro = new ResizeObserver(tick);
    lgBindStickTop._ro.disconnect();
    if (hdr) lgBindStickTop._ro.observe(hdr);
    if (stick) lgBindStickTop._ro.observe(stick);   // 초안 행이 붙어 높이가 바뀌어도 빈 칸을 맞춘다
  }
  if (lgBindStickTop._bound) return;
  lgBindStickTop._bound = true;
  window.addEventListener('scroll', tick, { passive: true });
  window.addEventListener('resize', tick);
  window.addEventListener('load', tick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(tick).catch(() => {});
}

/* 단축키 리모컨 — 표 위에 줄로 깔아두지 않고, 오른아래 버튼 안에 접어둔다. */
function lgBindHelp() {
  const fab = document.getElementById('lg-helpfab');
  const pan = document.getElementById('lg-helppanel');
  if (!fab || !pan) return;
  const open = (on) => {
    pan.hidden = !on;
    fab.classList.toggle('on', on);
    fab.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  fab.addEventListener('click', (e) => { e.stopPropagation(); open(pan.hidden); });
  const x = document.getElementById('lg-helpx');
  if (x) x.addEventListener('click', () => open(false));
  document.addEventListener('click', (e) => {
    if (pan.hidden) return;
    if (pan.contains(e.target) || fab.contains(e.target)) return;
    open(false);
  });
  if (!lgBindHelp._key) {
    lgBindHelp._key = true;
    document.addEventListener('keydown', (e) => {
      const p = document.getElementById('lg-helppanel');
      if (!p) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const f = document.getElementById('lg-helpfab');
        p.hidden = !p.hidden;
        if (f) { f.classList.toggle('on', !p.hidden); f.setAttribute('aria-expanded', p.hidden ? 'false' : 'true'); }
        return;
      }
      if (e.key === 'Escape' && !p.hidden) {
        e.stopPropagation();
        p.hidden = true;
        const f = document.getElementById('lg-helpfab');
        if (f) { f.classList.remove('on'); f.setAttribute('aria-expanded', 'false'); }
      }
    }, true);
  }
}

/* 사용처 관리는 상단 '목록' 버튼(목록 관리 › 사용처)으로 옮겼다. 여기는 내역만 본다. */
function renderLedgerShell(body) {
  body.innerHTML = '<div id="lg-body" class="lg-nosub"></div>';
  renderLedgerPage(document.getElementById('lg-body'));
}

async function renderLedgerPage(body) {
  body.innerHTML = '<div class="lg-wrap"><div class="en-empty">불러오는 중…</div></div>';
  await enEnsureRefs();
  const g = EN.lg;
  if (g.quick && !g.from && !g.to) { const [f, t] = enQuickRange(g.quick); g.from = f; g.to = t; }
  const cats = [...EN.cats].sort((a, b) => a.sort_order - b.sort_order);
  const yNow = new Date().getFullYear();
  const years = []; for (let y = yNow; y >= 2023; y--) years.push(y);

  body.innerHTML = `
    <div class="lg-wrap">
      <div class="lg-stick lg-popwrap">
        <div class="lg-hd">
          <button class="lg-fbtn" data-pop="period" id="lg-hd-period">기간<i>▾</i></button>
          <input class="en-in grow" id="lg-q" placeholder="사용처 · 메모 검색" value="${enEsc(g.q)}">
          <button class="lg-fbtn${g.nogroup ? ' act' : ''}" id="lg-nogroup" title="사용처는 있는데 사용처 그룹이 비어 있는 기록만" aria-pressed="${g.nogroup ? 'true' : 'false'}">그룹 없음</button>
          <button class="lg-fbtn add" id="lg-addnew">＋ 새 행<kbd>A</kbd></button>
          <button class="lg-fbtn save" id="lg-savetop" hidden>모두 저장<kbd>⌘⏎</kbd></button>
          <button class="lg-reset" id="lg-reset">초기화</button>
        </div>
        <div class="lg-cols">
          <button class="k hcell" data-pop="kind">종류<i>▾</i></button>
          <span class="e"></span>
          <button class="c hcell" data-pop="cat">분류<i>▾</i></button>
          <span class="n">사용처</span>
          <span class="mm">메모</span><span class="f">회사·고정</span><span class="g">GOOD/BAD</span>
          <button class="v hcell" data-pop="amt">금액<i>▾</i></button>
          <span class="x"></span>
        </div>
        <div class="lg-add" id="lg-add"></div>
        <div class="lg-pop" id="lg-pop" hidden></div>

        <div id="lg-pop-store" hidden>
          <div data-panel="period">
            <div class="pgrp">
              <span class="lg-glab">기간</span>
              <div class="lg-quick" id="lg-quick">
                <button data-q="tm">이번달</button><button data-q="lm">지난달</button>
                <button data-q="3m">최근 3개월</button><button data-q="ty">올해</button><button data-q="all">전체</button>
              </div>
            </div>
            <div class="pgrp">
              <span class="lg-glab">연도 · 월</span>
              <div class="lg-gin">
                <select class="en-in" id="lg-y"><option value="">연도</option>${years.map(y => `<option value="${y}">${y}년</option>`).join('')}</select>
                <select class="en-in" id="lg-m"><option value="">월</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('')}</select>
              </div>
            </div>
            <div class="pgrp">
              <span class="lg-glab">정렬</span>
              <select class="en-in" id="lg-sort" style="width:100%;">
                <option value="date_desc">최신순</option><option value="date_asc">오래된순</option>
                <option value="amt_desc">금액 큰 순</option><option value="amt_asc">금액 작은 순</option>
                <option value="created_desc">입력한 순서</option></select>
            </div>
          </div>
          <div data-panel="kind">
            <span class="lg-glab">종류</span>
            <div class="lg-gin lg-kinds" id="lg-kinds">
              <button data-k="all">전체</button>
              <button data-k="지출" class="kd 지출">지출</button>
              <button data-k="수입" class="kd 수입">수입</button>
              <button data-k="이체" class="kd 이체">이체</button>
            </div>
          </div>
          <div data-panel="cat">
            <span class="lg-glab">분류</span>
            <div class="lg-gin lg-catpick">
              <input class="en-in grow" id="lg-catq" placeholder="입력해서 찾기" autocomplete="off"
                     role="combobox" aria-expanded="false" aria-controls="lg-catdrop">
              <button class="lg-catx" id="lg-catx" aria-label="분류 해제" hidden>×</button>
              <div class="lg-catdrop" id="lg-catdrop" role="listbox" hidden></div>
            </div>
          </div>
          <div data-panel="amt">
            <span class="lg-glab">금액 정렬</span>
            <div class="lg-gin lg-kinds">
              <button data-sortas="amt_desc">큰 순</button>
              <button data-sortas="amt_asc">작은 순</button>
              <button data-sortas="date_desc">해제(최신순)</button>
            </div>
          </div>
        </div>
      </div>
      <div id="lg-list"><div class="en-empty">불러오는 중…</div></div>
      <div class="lg-meta">
        <span id="lg-count"></span>
        <span class="lg-pager">
          <button id="lg-prev">‹ 이전</button><button id="lg-next">다음 ›</button>
        </span>
      </div>

      <button class="lg-helpfab" id="lg-helpfab" type="button"
              title="단축키 (?)" aria-label="단축키 보기" aria-expanded="false">⌨</button>
      <div class="lg-helppanel" id="lg-helppanel" hidden>
        <div class="lg-helphd">
          <span>단축키</span>
          <button type="button" class="lg-helpx" id="lg-helpx" aria-label="닫기">×</button>
        </div>
        <div class="lg-helpgrid">
          <span class="hk"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></span><span class="hv">칸 이동</span>
          <span class="hk"><kbd>Shift</kbd>+이동·클릭</span><span class="hv">여러 칸 묶기</span>
          <span class="hk"><kbd>Space</kbd></span><span class="hv">한 행 통째로</span>
          <span class="hk"><kbd>Enter</kbd></span><span class="hv">고치기 (그냥 쳐도 시작)</span>
          <span class="hk"><kbd>Tab</kbd></span><span class="hv">오른쪽 칸</span>
          <span class="hk"><kbd>⌘</kbd>+<kbd>C</kbd></span><span class="hv">복사</span>
          <span class="hk"><kbd>⌘</kbd>+<kbd>⏎</kbd></span><span class="hv">모두 저장</span>
          <span class="hk"><kbd>Esc</kbd></span><span class="hv">해제</span>
          <span class="hk"><kbd>/</kbd></span><span class="hv">검색칸로</span>
          <span class="hk"><kbd>A</kbd></span><span class="hv">새 행</span>
          <span class="hk"><kbd>F</kbd> · <kbd>K</kbd> · <kbd>C</kbd></span><span class="hv">기간 · 종류 · 분류</span>
          <span class="hk"><kbd>?</kbd></span><span class="hv">이 창 열기·닫기</span>
        </div>
      </div>
    </div>`;

  enQS('#lg-sort').value = g.sort;
  document.querySelectorAll('#lg-quick button').forEach(b =>
    b.classList.toggle('on', b.dataset.q === g.quick));
  lgSetupKindCat(g, cats);
  lgRenderAdd();
  lgBindStickTop();

  document.querySelectorAll('#lg-quick button').forEach(b => b.addEventListener('click', () => {
    g.quick = b.dataset.q;
    const [f, t] = enQuickRange(g.quick);
    g.from = f; g.to = t; g.page = 1;
    enQS('#lg-y').value = ''; enQS('#lg-m').value = '';
    document.querySelectorAll('#lg-quick button').forEach(x => x.classList.toggle('on', x === b));
    enLoadLedger();
  }));

  const applyYM = () => {
    const y = enQS('#lg-y').value, m = enQS('#lg-m').value;
    if (!y) return;
    g.quick = '';
    document.querySelectorAll('#lg-quick button').forEach(x => x.classList.remove('on'));
    if (m) {
      const mm = Number(m);
      g.from = `${y}-${String(mm).padStart(2, '0')}-01`;
      const last = new Date(Number(y), mm, 0).getDate();
      g.to = `${y}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    } else { g.from = `${y}-01-01`; g.to = `${y}-12-31`; }
    g.page = 1;
    enLoadLedger();
  };
  enQS('#lg-y').addEventListener('change', applyYM);
  enQS('#lg-m').addEventListener('change', applyYM);

  let timer = null;
  enQS('#lg-q').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { g.q = e.target.value.trim(); g.page = 1; enLoadLedger(); }, 300);
  });
  enQS('#lg-sort').addEventListener('change', e => { g.sort = e.target.value; g.page = 1; enLoadLedger(); });
  /* 사용처 그룹이 안 정해진 기록만 — 그룹을 채워 넣으면 목록에서 빠진다 */
  enQS('#lg-nogroup').addEventListener('click', (e) => {
    g.nogroup = !g.nogroup; g.page = 1;
    e.currentTarget.classList.toggle('act', g.nogroup);
    e.currentTarget.setAttribute('aria-pressed', g.nogroup ? 'true' : 'false');
    enLoadLedger();
  });
  enQS('#lg-reset').addEventListener('click', () => {
    EN.lg = { q: '', kind: 'all', cat: 'all', from: '', to: '', quick: '3m', sort: 'date_desc', page: 1, size: 60 };
    renderLedgerPage(document.getElementById('lg-body'));
  });
  enQS('#lg-prev').addEventListener('click', () => { if (g.page > 1) { g.page--; enLoadLedger(); } });
  enQS('#lg-next').addEventListener('click', () => { g.page++; enLoadLedger(); });

  /* 금액 머리글에서 바로 정렬 — 정렬 select 를 대신 눌러준다 */
  document.querySelectorAll('[data-sortas]').forEach(b => b.addEventListener('click', () => {
    const sel = enQS('#lg-sort');
    sel.value = b.dataset.sortas;
    sel.dispatchEvent(new Event('change'));
    lgPopClose();
  }));

  enQS('#lg-addnew').addEventListener('click', () => lgDraftAdd());
  enQS('#lg-savetop').addEventListener('click', () => lgDraftSave());

  lgPopInit();
  lgSyncHead();
  lgBindKeys();
  lgBindHelp();
  enSyncHeaderOffset();
  enLoadLedger();
}

/* ---------------- 머리줄 팝오버 ----------------
   패널은 #lg-pop-store 에 숨겨둔 채 이벤트를 걸어두고, 열 때 팝오버로 '옮긴다'.
   새로 그리지 않으므로 기존 바인딩이 그대로 살아 있다. */
const LGPOP = { open: null };

function lgPopClose() {
  const pop = document.getElementById('lg-pop');
  const store = document.getElementById('lg-pop-store');
  if (!pop || !store) return;
  while (pop.firstChild) store.appendChild(pop.firstChild);
  pop.hidden = true;
  document.querySelectorAll('[data-pop]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  LGPOP.open = null;
}

function lgPopOpen(name) {
  const pop = document.getElementById('lg-pop');
  const store = document.getElementById('lg-pop-store');
  const btn = document.querySelector(`[data-pop="${name}"]`);
  if (!pop || !btn || !store) return;
  /* 같은 것을 다시 누르면 닫는다. 패널은 이미 팝오버로 옮겨져 있으므로
     창고에서 찾기 전에 먼저 판단해야 한다. */
  if (LGPOP.open === name) { lgPopClose(); return; }
  lgPopClose();
  const panel = store.querySelector(`[data-panel="${name}"]`);
  if (!panel) return;
  pop.appendChild(panel);
  pop.hidden = false;
  /* 버튼 아래에 붙이되 오른쪽으로 넘치지 않게 */
  const wrap = pop.parentElement.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  let left = r.left - wrap.left;
  if (left + w > wrap.width) left = Math.max(0, wrap.width - w);
  pop.style.left = left + 'px';
  pop.style.top = (r.bottom - wrap.top + 4) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  LGPOP.open = name;
  const first = panel.querySelector('input,select,button');
  if (first) setTimeout(() => first.focus(), 20);
}

function lgPopInit() {
  document.querySelectorAll('[data-pop]').forEach(b => {
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', (e) => { e.stopPropagation(); lgPopOpen(b.dataset.pop); });
  });
  const pop = document.getElementById('lg-pop');
  if (pop) pop.addEventListener('click', e => e.stopPropagation());
  if (!document.__lgPopDoc) {
    document.__lgPopDoc = true;
    /* 바깥을 누르면 닫는다. 전파 차단에 기대지 않고 대상으로 판단한다. */
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && (t.closest('[data-pop]') || t.closest('#lg-pop'))) return;
      lgPopClose();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lgPopClose(); });
  }
}

/* 지금 무엇이 걸려 있는지 머리글에 표시한다 */
function lgSyncHead() {
  const g = EN.lg;
  const setB = (sel, on, label) => {
    const b = document.querySelector(sel);
    if (!b) return;
    b.classList.toggle('act', !!on);
    b.innerHTML = enEsc(label) + '<i>▾</i>';
  };
  const QL = { tm: '이번달', lm: '지난달', '3m': '최근 3개월', ty: '올해', all: '전체' };
  const period = g.quick ? QL[g.quick]
    : (g.from ? `${g.from.slice(0, 7)} ~ ${g.to.slice(0, 7)}` : '기간');
  setB('#lg-hd-period', g.quick !== '3m', period);
  setB('[data-pop="kind"]', g.kind !== 'all', g.kind === 'all' ? '종류' : g.kind);
  const c = g.cat !== 'all' ? EN.catById[Number(g.cat)] : null;
  setB('[data-pop="cat"]', g.cat !== 'all', c ? c.subcategory : '분류');
  setB('[data-pop="amt"]', /^amt_/.test(g.sort), g.sort === 'amt_desc' ? '금액 ↓'
    : g.sort === 'amt_asc' ? '금액 ↑' : '금액');
}

/* 목록·초안 밖에서 쓰는 화면 단축키 */
function lgBindKeys() {
  if (document.__lgKeys) document.removeEventListener('keydown', document.__lgKeys);
  const h = (e) => {
    if (!document.getElementById('lg-list')) return;      // 내역 화면이 아닐 때는 무시
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    const k = e.key.toLowerCase();
    if (e.key === '/') { e.preventDefault(); const q = enQS('#lg-q'); if (q) { q.focus(); q.select(); } return; }
    if (k === 'a') { e.preventDefault(); lgDraftAdd(); return; }
    if (k === 'f') { e.preventDefault(); lgPopOpen('period'); return; }
    if (k === 'k') { e.preventDefault(); lgPopOpen('kind'); return; }
    if (k === 'c') { e.preventDefault(); lgPopOpen('cat'); return; }
  };
  document.__lgKeys = h;
  document.addEventListener('keydown', h);
}

/* 종류는 칩으로, 분류는 검색으로 — 고르는 순서가 생각의 순서와 같도록.
   종류를 먼저 좁히면 분류 후보도 같이 좁아진다. */
function lgSetupKindCat(g, cats) {
  const chips = document.getElementById('lg-kinds');
  const inp = enQS('#lg-catq');
  const drop = enQS('#lg-catdrop');
  const clear = enQS('#lg-catx');
  if (!chips || !inp || !drop) return;

  const catLabel = (c) => `${c.category} › ${c.subcategory}`;
  const paintChips = () => {
    chips.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.dataset.k === g.kind));
  };
  const paintCat = () => {
    const c = EN.catById[Number(g.cat)];
    if (g.cat !== 'all' && c) {
      inp.value = catLabel(c);
      inp.classList.add('picked');
      clear.hidden = false;
    } else {
      inp.value = '';
      inp.classList.remove('picked');
      clear.hidden = true;
    }
  };
  const pool = () => cats.filter(c => g.kind === 'all' || c.kind === g.kind);
  const close = () => { drop.hidden = true; inp.setAttribute('aria-expanded', 'false'); };

  let cur = -1, list = [];
  const paintCursor = () => drop.querySelectorAll('.lg-catopt').forEach((el, i) =>
    el.classList.toggle('on', i === cur));

  const open = () => {
    const q = inp.classList.contains('picked') ? '' : inp.value.trim().toLowerCase();
    list = pool().filter(c => !q ||
      (c.category + ' ' + c.subcategory + ' ' + c.kind).toLowerCase().includes(q)).slice(0, 60);
    if (!list.length) {
      drop.innerHTML = '<div class="lg-catempty">일치하는 분류가 없습니다.</div>';
    } else {
      let last = '';
      drop.innerHTML = list.map((c, i) => {
        const head = c.kind !== last ? `<div class="lg-cathead">${c.kind}</div>` : '';
        last = c.kind;
        return head + `<div class="lg-catopt" role="option" data-i="${i}">
          <span class="lg-kd ${c.kind}">${c.kind}</span>
          <span class="em">${c.emoji_category || ''}</span>
          <span class="tx">${enEsc(c.category)} › <b>${enEsc(c.subcategory)}</b></span>
        </div>`;
      }).join('');
    }
    drop.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    cur = -1;
    drop.querySelectorAll('.lg-catopt').forEach(el =>
      el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(list[Number(el.dataset.i)]); }));
  };
  const pick = (c) => {
    if (!c) return;
    g.cat = String(c.id);
    if (g.kind !== 'all' && g.kind !== c.kind) { g.kind = c.kind; paintChips(); }
    g.page = 1;
    paintCat(); close(); enLoadLedger();
  };

  chips.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    g.kind = b.dataset.k;
    /* 고른 종류와 안 맞는 분류는 자동으로 푼다 — 결과가 0건인 조합을 남기지 않는다 */
    const c = EN.catById[Number(g.cat)];
    if (g.kind !== 'all' && c && c.kind !== g.kind) g.cat = 'all';
    g.page = 1;
    paintChips(); paintCat(); enLoadLedger();
  }));

  inp.addEventListener('focus', () => { if (inp.classList.contains('picked')) { inp.value = ''; inp.classList.remove('picked'); } open(); });
  inp.addEventListener('input', open);
  inp.addEventListener('blur', () => setTimeout(() => { close(); paintCat(); }, 120));
  inp.addEventListener('keydown', (e) => {
    if (drop.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, list.length - 1); paintCursor(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paintCursor(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(list[cur >= 0 ? cur : 0]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); paintCat(); inp.blur(); }
  });
  clear.addEventListener('click', () => { g.cat = 'all'; g.page = 1; paintCat(); enLoadLedger(); });

  paintChips(); paintCat();
}

/* 기존 sticky 헤더 높이만큼 아래에 붙인다 */
function enSyncHeaderOffset() {
  const set = () => {
    const el = document.querySelector('.site-header');
    if (!el) return;
    const px = Math.round(el.getBoundingClientRect().height);
    if (px > 0) document.documentElement.style.setProperty('--hdr-h', px + 'px');
  };
  set();
  requestAnimationFrame(set);
  setTimeout(set, 250);
  /* 배너가 떴다 사라지거나 글꼴이 늦게 붙어 머리줄 높이가 바뀌면 그때그때 다시 잰다.
     예전엔 처음 잰 값이 그대로 남아, 실제보다 큰 값이면 내역 고정줄이 그만큼 아래로
     밀려 내려와 '＋ 새 행' 초안 줄을 덮어버렸다. */
  const hdrEl = document.querySelector('.site-header');
  if (hdrEl && window.ResizeObserver) {
    if (!enSyncHeaderOffset._ro) enSyncHeaderOffset._ro = new ResizeObserver(set);
    enSyncHeaderOffset._ro.disconnect();
    enSyncHeaderOffset._ro.observe(hdrEl);
  }
  if (!enSyncHeaderOffset._bound) {
    enSyncHeaderOffset._bound = true;
    window.addEventListener('resize', set);
  }
}

function enLedgerQuery(sb, mode) {
  const g = EN.lg;
  let q;
  if (mode === 'count') q = sb.from('v_transactions').select('id', { count: 'exact', head: true });
  else if (mode === 'sum') q = sb.from('v_transactions').select('kind,amount');
  else q = sb.from('v_transactions').select('id,date,kind,category,subcategory,emoji_category,amount,merchant_group,merchant,note,good_bad,company_paid,category_id');
  if (g.kind !== 'all') q = q.eq('kind', g.kind);
  if (g.cat !== 'all') q = q.eq('category_id', Number(g.cat));
  if (g.nogroup) q = q.is('merchant_group', null).not('merchant', 'is', null).neq('merchant', '');
  if (g.from) q = q.gte('date', g.from);
  if (g.to) q = q.lte('date', g.to);
  if (g.q) { const t = g.q.replace(/[,%]/g, ' '); q = q.or(`merchant.ilike.%${t}%,note.ilike.%${t}%`); }
  return q;
}

async function enLoadLedger() {
  /* 전체 내역 화면이 떠 있을 때만 의미가 있다. 다른 탭에서 수정한 경우 헛돌지 않게 먼저 끊는다. */
  if (!enQS('#lg-list')) return;
  lgSyncStickTop();
  if (typeof lgSyncHead === 'function') lgSyncHead();   // 머리글에 지금 걸린 필터를 비춘다
  const sb = await enClient();
  const g = EN.lg;
  const sorts = {
    date_desc: ['date', false], date_asc: ['date', true],
    amt_desc: ['amount', false], amt_asc: ['amount', true],
    created_desc: ['id', false]
  };
  const [col, asc] = sorts[g.sort] || sorts.date_desc;
  const from = (g.page - 1) * g.size;

  /* 이 화면은 기록을 편하게 하는 곳이다. 합계·순액 같은 지표는 리포트가 맡는다.
     지표를 걷어낸 덕분에 합계 질의(sum)도 한 번 덜 나간다. */
  const [rowsRes, cntRes] = await Promise.all([
    enLedgerQuery(sb, 'rows').order(col, { ascending: asc }).range(from, from + g.size - 1),
    enLedgerQuery(sb, 'count')
  ]);
  const rows = rowsRes.data || [];
  const total = cntRes.count || 0;

  const box = enQS('#lg-list');
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="en-empty">조건에 맞는 기록이 없습니다. 기간이나 필터를 넓혀보세요.</div>';
  } else {
    const groups = [];
    const idx = {};
    rows.forEach(r => {
      const d = String(r.date);
      if (idx[d] === undefined) { idx[d] = groups.length; groups.push({ date: d, items: [] }); }
      groups[idx[d]].items.push(r);
    });
    /* 같은 날 안에서는 수입 → 지출 → 이체, 그 다음 금액 큰 순.
       들어온 돈과 나간 돈이 섞여 있으면 하루가 어땠는지 한눈에 안 잡힌다. */
    if (g.sort === 'date_desc' || g.sort === 'date_asc') {
      const rank = { '수입': 0, '지출': 1, '이체': 2 };
      groups.forEach(grp => grp.items.sort((a, b) =>
        (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) ||
        Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))));
    }
    box.innerHTML = groups.map(grp => {
      const dt = new Date(grp.date + 'T00:00:00');
      return `<div class="lg-dg" data-date="${grp.date}"><div class="lg-day">
          <span class="d">${grp.date.slice(2).replace(/-/g, '.')}</span>
          <span class="w">${EN_WD[dt.getDay()]}</span>
          <button class="lg-dayadd" data-add="${grp.date}" title="이 날짜로 행 추가" tabindex="-1">+</button>
          <span class="s">${grp.items.length}건</span>
        </div><div class="lg-card">` +
        grp.items.map(r => `<div class="lg-line k-${r.kind}" draggable="true" data-id="${r.id}" data-date="${r.date}"
          data-cat="${r.category_id}" data-amt="${r.amount}" data-mgroup="${enEsc(r.merchant_group || '')}"
          data-merch="${enEsc(r.merchant || '')}" data-note="${enEsc(r.note || '')}">
          <span class="k"><i class="lg-kd ${r.kind}">${r.kind}</i></span>
          <span class="e" aria-hidden="true">${r.emoji_category || ''}</span>
          <span class="c" data-ed="cat" title="눌러서 분류 변경"><span class="ct">${enEsc(r.category)} › ${enEsc(r.subcategory)}</span></span>
          <span class="n" data-ed="merchant" title="더블클릭해서 수정">${r.merchant_group ? `<i class="lg-mg">${enEsc((mgEmojiSet(r.merchant_group) ? mgEmojiSet(r.merchant_group) + ' ' : '') + r.merchant_group)}</i>` : ''}${enEsc(r.merchant || r.subcategory)}</span>
          <span class="mm" data-ed="note" title="더블클릭해서 메모 수정">${r.note ? enEsc(r.note) : '<i class="lg-ph">메모</i>'}</span>
          <span class="f">
            <button class="lg-tg ${r.company_paid ? 'on' : ''}" data-tg="company_paid" title="회사 환급" tabindex="-1">🏢</button>
            ${lgFixedMark(txFixed(r.kind, r.category, r.subcategory))}
          </span>
          <span class="g">${r.kind === '지출'
            ? `<button class="lg-gb ${r.good_bad === 'Good' ? 'good' : r.good_bad === 'Bad' ? 'bad' : ''}" data-gb tabindex="-1" title="클릭해서 Good → Bad → 해제">${r.good_bad === 'Good' ? 'GOOD' : r.good_bad === 'Bad' ? 'BAD' : '—'}</button>`
            : '<span class="lg-na" title="지출에만 매깁니다">·</span>'}</span>
          <span class="v ${r.kind}" data-ed="amount" title="더블클릭해서 수정">${Number(r.amount) < 0 ? '−' : ''}${enComma(Math.abs(r.amount))}</span>
          <button class="x" data-id="${r.id}" aria-label="삭제" tabindex="-1">×</button>
        </div>`).join('') + '</div></div>';
    }).join('');
    box.querySelectorAll('.x').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      await (await enClient()).from('transactions').delete().eq('id', Number(b.dataset.id));
      enToast('삭제했습니다');
      lgTouched();
      enLoadLedger();
    }));
    lgBindEdit(box);
    lgBindDrag(box);
    box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      lgDraftAdd(b.dataset.add);
    }));
  }
  lgGridInit(box);

  const last = Math.max(1, Math.ceil(total / g.size));
  enQS('#lg-count').textContent = total
    ? `${enComma(total)}건 중 ${enComma(from + 1)}–${enComma(Math.min(from + g.size, total))} · ${g.page}/${last}`
    : '0건';
  enQS('#lg-prev').disabled = g.page <= 1;
  enQS('#lg-next').disabled = g.page >= last;
}

/* ---------------- 전체 내역 : 칸을 더블클릭해서 그 자리에서 고친다 ----------------
   고친 값은 곧바로 transactions 테이블에 반영된다. 화면만 바뀌는 수정은 만들지 않는다. */
async function lgUpdate(id, patch) {
  const { error } = await (await enClient()).from('transactions').update(patch).eq('id', id);
  if (error) { enToast('저장하지 못했습니다'); return false; }
  return true;
}

function lgCellEdit(cell, opts) {
  if (cell.classList.contains('editing')) return;
  const seed = opts && opts.seed;
  const line = cell.closest('.lg-line');
  const id = Number(line.dataset.id);
  const what = cell.dataset.ed;
  const prev = cell.innerHTML;
  let done = false;
  LGK.editing = true;
  LGK.move = null;
  cell.classList.add('editing');

  let input, catHidden = null;
  if (what === 'cat') {
    /* 셀렉트로는 수십 개 소분류를 못 찾는다. 검색 + 종류 칩 + 이모지가 붙은 목록으로 고른다. */
    input = document.createElement('input');
    input.className = 'lg-ed cat';
    input.setAttribute('autocomplete', 'off');
    input.placeholder = '입력해서 찾기';
    catHidden = document.createElement('input');
    catHidden.type = 'hidden';
    catHidden.value = line.dataset.cat || '';
    const curCat = EN.catById[Number(line.dataset.cat)];
    input.value = curCat ? `${curCat.category} › ${curCat.subcategory}` : '';
  } else {
    input = document.createElement('input');
    input.className = 'lg-ed' + (what === 'amount' ? ' mono' : '');
    if (what === 'amount') {
      input.inputMode = 'numeric';
      const n = Number(line.dataset.amt);
      input.value = (n < 0 ? '−' : '') + enComma(Math.abs(n));
    } else if (what === 'merchant') {
      const gp = line.dataset.mgroup || '';
      input.value = (gp ? gp + ' › ' : '') + (line.dataset.merch || '');
    } else {
      input.value = line.dataset.note || '';
    }
  }

  if (seed != null && what !== 'cat') input.value = seed;

  cell.innerHTML = '';
  cell.appendChild(input);
  if (catHidden) { cell.appendChild(catHidden); lgCatPick(input, catHidden, null, { fixed: true }); }
  if (what === 'merchant') lgMerchantAC(input);
  input.focus();
  if (input.select && seed == null) input.select();
  if (seed != null && input.setSelectionRange) {
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) {}
  }

  /* 고치고 나면 어디에 서 있을지를 정해 둔다 — 화면을 다시 그려도 그 자리를 되찾게 */
  const inGrid = !!(cell.closest && cell.closest('#lg-list'));
  const land = (reloaded) => {
    const mv = LGK.move; LGK.move = null;
    LGK.editing = false;
    if (!inGrid) return;   /* '오늘' 탭에도 같은 행이 쓰인다 — 거긴 표가 아니다 */
    if (reloaded) { LGK.want = { id, col: what, move: mv }; return; }
    lgGridLand(cell, mv);
  };

  const finish = async (commit) => {
    if (done) return;
    done = true;
    cell.classList.remove('editing');
    /* body 에 띄워둔 분류 목록이 남지 않게 여기서 확실히 걷는다 */
    document.querySelectorAll('.lg-cpfixed').forEach(b => b.remove());
    const bail = () => { cell.innerHTML = prev; land(false); };
    if (!commit) { bail(); return; }
    const patch = {};
    if (what === 'cat') {
      const cid = Number(catHidden ? catHidden.value : input.value);
      if (!cid || cid === Number(line.dataset.cat)) { bail(); return; }
      patch.category_id = cid;
    } else if (what === 'amount') {
      const t = input.value.trim();
      const neg = /^[-−]/.test(t);
      const n = Number(t.replace(/[^\d]/g, ''));
      if (!n) { bail(); return; }
      const v = neg ? -n : n;
      if (v === Number(line.dataset.amt)) { bail(); return; }
      patch.amount = v;
    } else if (what === 'merchant') {
      const v = input.value.trim();
      const was = (line.dataset.mgroup ? line.dataset.mgroup + ' › ' : '') + (line.dataset.merch || '');
      if (v === was) { bail(); return; }
      const parts = lgSplitMerchant(v);
      patch.merchant_group = parts.group;
      patch.merchant = parts.merchant;
    } else {
      const v = input.value.trim();
      if (v === (line.dataset.note || '')) { bail(); return; }
      patch.note = v || null;
    }
    const ok = await lgUpdate(id, patch);
    if (!ok) { bail(); return; }
    /* 입력칸을 반드시 걷어낸다 — 남겨두면 뒤따르는 화면 갱신이 '편집 중'으로 보고 건너뛴다 */
    cell.innerHTML = prev;
    land(true);
    enToast('수정했습니다');
    lgTouched();
    enLoadLedger();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); LGK.move = e.shiftKey ? 'up' : 'down'; finish(true); }
    else if (e.key === 'Tab') { e.preventDefault(); LGK.move = e.shiftKey ? 'left' : 'right'; finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); LGK.move = null; finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  if (what === 'cat' && catHidden) catHidden.addEventListener('change', () => finish(true));
}

function lgBindEdit(box) {
  box.querySelectorAll('[data-ed]').forEach(cell =>
    cell.addEventListener('dblclick', () => lgCellEdit(cell)));

  /* 분류는 한 번만 눌러도 바로 목록이 열린다 — 제일 자주 고치는 칸인데
     칸 고르기 → 편집 시작 두 단계를 거칠 이유가 없다. */
  box.querySelectorAll('[data-ed="cat"]').forEach(cell =>
    cell.addEventListener('click', (e) => {
      if (e.detail > 1) return;                 /* 더블클릭은 위 핸들러가 받는다 */
      if (LGK.editing || cell.classList.contains('editing')) return;
      lgCellEdit(cell);
    }));

  box.querySelectorAll('[data-tg]').forEach(btn => btn.addEventListener('click', async () => {
    const line = btn.closest('.lg-line');
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    const patch = {}; patch[btn.dataset.tg] = on;
    const ok = await lgUpdate(Number(line.dataset.id), patch);
    if (!ok) { btn.classList.toggle('on', !on); return; }
    lgTouched();
  }));

  box.querySelectorAll('[data-gb]').forEach(btn => btn.addEventListener('click', async () => {
    const line = btn.closest('.lg-line');
    const cur = btn.classList.contains('good') ? 'Good' : btn.classList.contains('bad') ? 'Bad' : null;
    const next = cur === null ? 'Good' : cur === 'Good' ? 'Bad' : null;
    btn.className = 'lg-gb ' + (next === 'Good' ? 'good' : next === 'Bad' ? 'bad' : '');
    btn.textContent = next === 'Good' ? 'GOOD' : next === 'Bad' ? 'BAD' : '—';
    const ok = await lgUpdate(Number(line.dataset.id), { good_bad: next });
    if (!ok) {
      btn.className = 'lg-gb ' + (cur === 'Good' ? 'good' : cur === 'Bad' ? 'bad' : '');
      btn.textContent = cur === 'Good' ? 'GOOD' : cur === 'Bad' ? 'BAD' : '—';
    }
  }));
}

/* 고정비 표시 — 누르는 버튼이 아니라 예산 분류(📌)를 따라 켜지는 표시다. 바꾸려면 설정 › 예산 */
function lgFixedMark(on) {
  return `<span class="rx-tg ${on ? 'on' : ''}" title="${on ? '고정비 — 설정 › 예산에서 📌 인 분류' : '고정비 아님'}">📌</span>`;
}

/* 분류를 셀렉트 대신 검색으로 고른다 — 소분류가 수십 개라 스크롤로는 못 찾는다.
   보이는 칸은 input, 실제 값은 옆의 hidden 이 들고 있다. */
function lgCatPick(input, hidden, onPick, opts) {
  if (!input || input.dataset.cp) return;
  input.dataset.cp = '1';
  const O = opts || {};
  const rank = { '지출': 0, '수입': 1, '이체': 2 };
  const all = () => [...EN.cats].sort((a, b) =>
    (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.sort_order - b.sort_order);
  const box = document.createElement('div');
  box.className = 'lg-catdrop lg-cpdrop' + (O.fixed ? ' lg-cpfixed' : '');
  box.hidden = true;
  /* 표 안(칸 편집)에서 쓸 때는 칸 안에 붙이면 잘린다 — 내역 카드가 overflow:hidden 이다.
     그래서 body 에 붙이고 입력칸 위치를 따라 화면 좌표로 띄운다. */
  (O.fixed ? document.body : (input.parentElement || document.body)).appendChild(box);
  const place = () => {
    if (!O.fixed) return;
    const r = input.getBoundingClientRect();
    const w = Math.max(300, r.width);
    box.style.width = w + 'px';
    box.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 10))) + 'px';
    const below = window.innerHeight - r.bottom;
    if (below < 230 && r.top > below) { box.style.top = 'auto'; box.style.bottom = Math.round(window.innerHeight - r.top + 5) + 'px'; }
    else { box.style.bottom = 'auto'; box.style.top = Math.round(r.bottom + 5) + 'px'; }
  };

  let list = [], cur = -1;
  const label = (c) => `${c.category} › ${c.subcategory}`;
  const close = () => { box.hidden = true; cur = -1; if (O.fixed && !input.isConnected) box.remove(); };
  const paint = () => box.querySelectorAll('.lg-catopt').forEach((el, i) => el.classList.toggle('on', i === cur));
  const restore = () => {
    const c = EN.catById[Number(hidden.value)];
    input.value = c ? label(c) : '';
  };
  const open = () => {
    const q = input.value.trim().toLowerCase();
    const chosen = EN.catById[Number(hidden.value)];
    const isLabel = chosen && input.value === label(chosen);
    list = all().filter(c => !q || isLabel ||
      (c.category + ' ' + c.subcategory + ' ' + c.kind).toLowerCase().includes(q)).slice(0, 60);
    if (!list.length) { box.innerHTML = '<div class="lg-catempty">일치하는 분류가 없습니다.</div>'; box.hidden = false; place(); return; }
    let last = '';
    box.innerHTML = list.map((c, i) => {
      const head = c.kind !== last ? `<div class="lg-cathead">${c.kind}</div>` : '';
      last = c.kind;
      return head + `<div class="lg-catopt" data-i="${i}">
        <span class="lg-kd ${c.kind}">${c.kind}</span>
        <span class="em">${c.emoji_category || ''}</span>
        <span class="tx">${enEsc(c.category)} › <b>${enEsc(c.subcategory)}</b></span></div>`;
    }).join('');
    box.hidden = false;
    place();
    cur = -1;
    box.querySelectorAll('.lg-catopt').forEach(el =>
      el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(list[Number(el.dataset.i)]); }));
  };
  const pick = (c) => {
    if (!c) return;
    hidden.value = String(c.id);
    input.value = label(c);
    close();
    if (onPick) onPick(c);
    hidden.dispatchEvent(new Event('change'));
  };

  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('input', open);
  input.addEventListener('blur', () => setTimeout(() => { close(); restore(); }, 130));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, list.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(list[cur >= 0 ? cur : 0]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); restore(); }
  });
}

/* '그룹 › 사용처' 한 칸으로 다룬다 — 입력창을 늘리지 않고 둘 다 고칠 수 있게 */
function lgSplitMerchant(v) {
  const t = String(v || '').trim();
  if (!t) return { group: null, merchant: null };
  if (t.includes('›')) {
    const p = t.split('›');
    return { group: p[0].trim() || null, merchant: p.slice(1).join('›').trim() || null };
  }
  return { group: null, merchant: t };
}

/* 사용처 자동완성 — 어떤 그룹·분류로 쓰던 곳인지 같이 보여준다.
   고르면 분류까지 따라오게 onPick 으로 넘긴다. */
/* 사용처 목록은 화면에 딱 하나만 있으면 된다 — 한 번에 한 칸만 입력 중이니까.
   예전에는 입력칸마다 새로 만들어 body 에 붙였는데, 초안 행이 다시 그려질 때
   입력칸이 blur 없이 사라져 옛 목록이 body 에 그대로 남았다. 그 위에 새 목록이
   겹쳐 뜨면 같은 사용처가 두 번 보인다. 하나를 돌려 쓰면 그럴 일이 없다. */
function lgACBox() {
  let b = document.getElementById('lg-acbox');
  if (!b) {
    b = document.createElement('div');
    b.id = 'lg-acbox';
    b.className = 'lg-acbox';
    b.hidden = true;
    document.body.appendChild(b);
    /* 스크롤 추적도 목록 하나에만 건다 — 입력칸마다 걸면 핸들러가 쌓인다 */
    window.addEventListener('scroll', () => {
      if (!b.hidden && typeof b.__place === 'function') b.__place();
    }, true);
  }
  return b;
}

function lgMerchantAC(input, onPick) {
  if (!input || input.dataset.ac) return;
  input.dataset.ac = '1';
  input.setAttribute('autocomplete', 'off');
  /* 목록은 body 에 붙이고 화면 좌표로 띄운다.
     표 안에 넣으면 겹침·잘림 규칙에 걸려 안 보이는 경우가 생긴다. */
  const box = lgACBox();
  const own = 'ac' + (lgMerchantAC._n = (lgMerchantAC._n || 0) + 1);
  const mine = () => box.dataset.own === own;
  const place = () => {
    const r = input.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 310)) + 'px';
    box.style.minWidth = Math.max(r.width, 260) + 'px';
    /* 아래에 자리가 없으면 위로 편다 — 화면 밑에 붙은 일괄 수정바에서도 목록이 보여야 한다 */
    const room = window.innerHeight - r.bottom;
    if (room < 200 && r.top > room) {
      box.style.top = 'auto';
      box.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      box.style.maxHeight = Math.min(280, r.top - 12) + 'px';
    } else {
      box.style.bottom = 'auto';
      box.style.top = (r.bottom + 4) + 'px';
      box.style.maxHeight = Math.min(280, room - 12) + 'px';
    }
  };

  let list = [], cur = -1;
  /* 내가 띄운 목록일 때만 닫는다 — 다른 칸이 이미 가져갔으면 건드리지 않는다 */
  const close = () => { if (mine()) { box.hidden = true; box.dataset.own = ''; } cur = -1; };
  const paint = () => box.querySelectorAll('.lg-acitem').forEach((el, i) => el.classList.toggle('on', i === cur));
  const groupOf = (m) => (EN.merchGroup && EN.merchGroup[m]) || '';
  const rows = () => (mine() ? box.querySelectorAll('.lg-acitem') : []);

  const open = () => {
    const raw = input.value.trim();
    const q = (raw.includes('›') ? raw.split('›').slice(1).join('›') : raw).trim().toLowerCase();
    const pool = EN.merchants || [];
    list = (q ? pool.filter(m => m.toLowerCase().includes(q) || groupOf(m).toLowerCase().includes(q)) : pool).slice(0, 40);
    const exact = list.some(m => m.toLowerCase() === q);
    const canAdd = q && !exact;
    if (!list.length && !canAdd) { close(); return; }
    box.dataset.own = own;
    box.__place = place;
    place();
    const raw2 = (raw.includes('›') ? raw.split('›').slice(1).join('›') : raw).trim();
    box.innerHTML = (canAdd ? `<div class="lg-acitem lg-acnew" data-new="1">
        <span class="gp">새로</span><span class="nm">＋ ${enEsc(raw2)} 사용처로 추가</span></div>` : '')
      + list.map((m, i) => {
      const c = EN.catById[EN.merchCat[m]];
      const gp = groupOf(m);
      let nm = enEsc(m);
      if (q) {
        const at = m.toLowerCase().indexOf(q);
        if (at >= 0) nm = enEsc(m.slice(0, at)) + '<mark>' + enEsc(m.slice(at, at + q.length)) + '</mark>' + enEsc(m.slice(at + q.length));
      }
      return `<div class="lg-acitem" data-i="${i}" title="${c ? enEsc(c.category + ' › ' + c.subcategory) : '분류 없음'}">
        ${gp ? `<span class="gp">${enEsc(gp)}</span>` : '<span class="gp none">그룹 없음</span>'}
        <span class="nm">${nm}</span>
      </div>`;
    }).join('');
    box.hidden = false;
    cur = -1;
    box.querySelectorAll('.lg-acitem').forEach(el =>
      el.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        if (el.dataset.new) {
          const gp0 = raw.includes('›') ? raw.split('›')[0].trim() : '';
          await enRegisterMerchant(raw2, gp0);
          input.value = (gp0 ? gp0 + ' › ' : '') + raw2;
          close();
          if (onPick) onPick(raw2, EN.merchCat[raw2] || null);
          enToast(`사용처 '${raw2}' 등록했습니다`);
          return;
        }
        pick(list[Number(el.dataset.i)]);
      }));
  };
  const pick = (m) => {
    if (!m) return;
    const gp = groupOf(m);
    input.value = (gp ? gp + ' › ' : '') + m;
    close();
    if (onPick) onPick(m, EN.merchCat[m] || null);
  };

  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 130));
  input.addEventListener('keydown', (e) => {
    if (box.hidden || !mine()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, rows().length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paint(); }
    else if (e.key === 'Enter' && cur >= 0) {
      e.preventDefault(); e.stopPropagation();
      const el = rows()[cur];
      if (el) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}

/* 행을 다른 날짜 묶음으로 끌어다 놓으면 날짜가 바뀐다.
   가장 자주 고치는 게 날짜인데, 날짜 칸이 표에 없으니 이 방법이 제일 짧다. */
function lgBindDrag(box) {
  let dragId = null, dragFrom = null;
  box.querySelectorAll('.lg-line').forEach(line => {
    line.addEventListener('dragstart', (e) => {
      if (line.querySelector('.editing')) { e.preventDefault(); return; }
      dragId = Number(line.dataset.id);
      dragFrom = line.dataset.date;
      line.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); } catch (err) {}
    });
    line.addEventListener('dragend', () => {
      line.classList.remove('dragging');
      box.querySelectorAll('.lg-dg').forEach(g => g.classList.remove('over'));
      dragId = null;
    });
  });
  box.querySelectorAll('.lg-dg').forEach(g => {
    g.addEventListener('dragover', (e) => {
      if (dragId == null || g.dataset.date === dragFrom) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      g.classList.add('over');
    });
    g.addEventListener('dragleave', () => g.classList.remove('over'));
    g.addEventListener('drop', async (e) => {
      e.preventDefault();
      g.classList.remove('over');
      const id = dragId, to = g.dataset.date;
      if (id == null || !to || to === dragFrom) return;
      dragId = null;
      const ok = await lgUpdate(id, { date: to });
      if (!ok) return;
      enToast(`${to.slice(2).replace(/-/g, '.')} 로 옮겼습니다`);
      lgTouched();
      enLoadLedger();
    });
  });
}

/* ---------------- 전체 내역 : 표를 칸 단위로 돌아다니고, 묶어서 고친다 ----------------
   가계부를 정리하는 일은 한 줄을 고치는 일보다 '같은 걸 여러 줄에서 한꺼번에 고치는' 일이 많다.
   그래서 표를 스프레드시트처럼 다룬다 — 화살표로 칸을 옮기고, Shift로 범위를 잡고,
   잡힌 범위에 한 번에 같은 값을 넣는다. 마우스만으로도, 키보드만으로도 끝까지 갈 수 있어야 한다. */

const LGK = {
  cols: ['cat', 'merchant', 'note', 'amount'],
  labels: { cat: '분류', merchant: '사용처', note: '메모', amount: '금액' },
  rows: [], vis: [0, 1, 2, 3],
  cur: null, anchor: null, editing: false, move: null, want: null
};

function lgGridCell(r, c) {
  const row = LGK.rows[r];
  return row ? row.querySelector(`[data-ed="${LGK.cols[c]}"]`) : null;
}

function lgGridRange() {
  if (!LGK.cur) return null;
  const a = LGK.anchor || LGK.cur;
  return {
    r0: Math.min(a.r, LGK.cur.r), r1: Math.max(a.r, LGK.cur.r),
    c0: Math.min(a.c, LGK.cur.c), c1: Math.max(a.c, LGK.cur.c)
  };
}

function lgGridPaint() {
  const rng = lgGridRange();
  const many = !!rng && (rng.r0 !== rng.r1 || rng.c0 !== rng.c1);
  LGK.rows.forEach((row, r) => {
    let inRow = false;
    LGK.cols.forEach((name, c) => {
      const el = row.querySelector(`[data-ed="${name}"]`);
      if (!el) return;
      const on = !!rng && r >= rng.r0 && r <= rng.r1 && c >= rng.c0 && c <= rng.c1;
      const isCur = !!LGK.cur && LGK.cur.r === r && LGK.cur.c === c;
      el.classList.toggle('sel', on && many);
      el.classList.toggle('cur', isCur);
      el.tabIndex = isCur ? 0 : -1;
      if (on) inRow = true;
    });
    row.classList.toggle('rowsel', inRow && many && rng.r0 !== rng.r1);
  });
  /* 아무 칸도 안 잡혀 있으면 Tab 으로 표에 들어올 자리를 하나 열어 둔다 */
  if (!LGK.cur && LGK.rows.length) {
    const el = lgGridCell(0, LGK.vis[0]);
    if (el) el.tabIndex = 0;
  }
  lgBulkPaint();
}

function lgGridSet(r, c, extend) {
  if (r < 0 || r >= LGK.rows.length) return false;
  if (!LGK.vis.includes(c)) {
    c = LGK.vis.reduce((best, v) => Math.abs(v - c) < Math.abs(best - c) ? v : best, LGK.vis[0]);
  }
  LGK.cur = { r, c };
  if (!extend) LGK.anchor = { r, c };
  const el = lgGridCell(r, c);
  if (el) { el.tabIndex = 0; el.focus({ preventScroll: false }); }
  lgGridPaint();
  return true;
}

function lgGridMove(dr, dc, extend) {
  if (!LGK.cur) return lgGridSet(0, LGK.vis[0], false);
  let { r, c } = LGK.cur;
  if (dc) {
    let vi = LGK.vis.indexOf(c) + dc;
    if (vi < 0) { if (r > 0) { r--; vi = LGK.vis.length - 1; } else vi = 0; }
    else if (vi >= LGK.vis.length) { if (r < LGK.rows.length - 1) { r++; vi = 0; } else vi = LGK.vis.length - 1; }
    c = LGK.vis[vi];
  }
  if (dr) r = Math.max(0, Math.min(LGK.rows.length - 1, r + dr));
  return lgGridSet(r, c, extend);
}

function lgGridClear() {
  LGK.cur = null; LGK.anchor = null;
  lgGridPaint();
}

function lgGridEdit(seed) {
  if (!LGK.cur) return;
  const el = lgGridCell(LGK.cur.r, LGK.cur.c);
  if (el) lgCellEdit(el, seed != null ? { seed } : null);
}

/* 고친 다음 어디에 설지 — Enter 는 아래, Tab 은 오른쪽. 표를 안 쳐다봐도 이어서 칠 수 있게 */
function lgGridLand(cell, move) {
  const line = cell && cell.closest('.lg-line');
  if (!line) return;
  const r = LGK.rows.indexOf(line);
  const c = LGK.cols.indexOf(cell.dataset.ed);
  if (r < 0 || c < 0) return;
  lgGridSet(r, c, false);
  if (move === 'down') lgGridMove(1, 0, false);
  else if (move === 'up') lgGridMove(-1, 0, false);
  else if (move === 'right') lgGridMove(0, 1, false);
  else if (move === 'left') lgGridMove(0, -1, false);
}

function lgGridCopy() {
  const rng = lgGridRange();
  if (!rng) return;
  const out = [];
  for (let r = rng.r0; r <= rng.r1; r++) {
    const line = [];
    for (let c = rng.c0; c <= rng.c1; c++) {
      if (!LGK.vis.includes(c)) continue;
      const el = lgGridCell(r, c);
      line.push(el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    }
    out.push(line.join('\t'));
  }
  const text = out.join('\n');
  try {
    navigator.clipboard.writeText(text).then(() => enToast(`${out.length}행 복사했습니다`), () => {});
  } catch (e) { /* 클립보드를 못 쓰는 자리면 조용히 넘어간다 */ }
}

function lgGridInit(box) {
  LGK.rows = [...box.querySelectorAll('.lg-line')];
  LGK.editing = false;
  const want = LGK.want; LGK.want = null;

  if (!LGK.rows.length) { LGK.cur = null; LGK.anchor = null; lgBulkPaint(); return; }

  /* 좁은 화면에선 분류·메모 열이 접힌다. 접힌 칸으로는 옮겨 가지 않는다. */
  const first = LGK.rows[0];
  const vis = LGK.cols.map((name, i) => {
    const el = first.querySelector(`[data-ed="${name}"]`);
    return el && el.offsetParent !== null ? i : -1;
  }).filter(i => i >= 0);
  LGK.vis = vis.length ? vis : [0, 1, 2, 3];

  if (!box.dataset.grid) {
    box.dataset.grid = '1';
    box.addEventListener('mousedown', (e) => {
      const cell = e.target.closest && e.target.closest('[data-ed]');
      if (!cell || cell.classList.contains('editing')) return;
      const r = LGK.rows.indexOf(cell.closest('.lg-line'));
      const c = LGK.cols.indexOf(cell.dataset.ed);
      if (r < 0 || c < 0) return;
      if (e.shiftKey) {
        e.preventDefault();
        if (!LGK.anchor) LGK.anchor = LGK.cur || { r, c };
        LGK.cur = { r, c };
        const el = lgGridCell(r, c);
        if (el) { el.tabIndex = 0; el.focus({ preventScroll: true }); }
        lgGridPaint();
      } else {
        lgGridSet(r, c, false);
      }
    });
    box.addEventListener('focusin', (e) => {
      if (LGK.editing) return;
      const cell = e.target.closest && e.target.closest('[data-ed]');
      if (!cell) return;
      const r = LGK.rows.indexOf(cell.closest('.lg-line'));
      const c = LGK.cols.indexOf(cell.dataset.ed);
      if (r < 0 || c < 0) return;
      if (LGK.cur && LGK.cur.r === r && LGK.cur.c === c) return;
      LGK.cur = { r, c }; LGK.anchor = { r, c };
      lgGridPaint();
    });
    box.addEventListener('keydown', (e) => {
      if (LGK.editing) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (k === 'c' || k === 'C')) { lgGridCopy(); return; }
      if (mod && (k === 'a' || k === 'A')) {
        e.preventDefault();
        LGK.anchor = { r: 0, c: LGK.vis[0] };
        lgGridSet(LGK.rows.length - 1, LGK.vis[LGK.vis.length - 1], true);
        return;
      }
      if (mod) return;
      if (k === 'ArrowDown') { e.preventDefault(); lgGridMove(1, 0, e.shiftKey); }
      else if (k === 'ArrowUp') { e.preventDefault(); lgGridMove(-1, 0, e.shiftKey); }
      else if (k === 'ArrowRight') { e.preventDefault(); lgGridMove(0, 1, e.shiftKey); }
      else if (k === 'ArrowLeft') { e.preventDefault(); lgGridMove(0, -1, e.shiftKey); }
      else if (k === 'Tab') { e.preventDefault(); lgGridMove(0, e.shiftKey ? -1 : 1, false); }
      else if (k === 'Home') { e.preventDefault(); lgGridSet(LGK.cur ? LGK.cur.r : 0, LGK.vis[0], e.shiftKey); }
      else if (k === 'End') { e.preventDefault(); lgGridSet(LGK.cur ? LGK.cur.r : 0, LGK.vis[LGK.vis.length - 1], e.shiftKey); }
      else if (k === 'Enter' || k === 'F2') { e.preventDefault(); lgGridEdit(); }
      else if (k === 'Escape') { e.preventDefault(); lgGridClear(); }
      else if (k === ' ') {
        /* 한 행을 통째로 — 토글·삭제처럼 행 단위로 할 일이 많다 */
        e.preventDefault();
        if (!LGK.cur) return;
        LGK.anchor = { r: LGK.cur.r, c: LGK.vis[0] };
        lgGridSet(LGK.cur.r, LGK.vis[LGK.vis.length - 1], true);
      }
      else if (!e.altKey && k.length === 1) {
        /* 그냥 치기 시작하면 그 글자로 고치기가 열린다 */
        if (LGK.cur && LGK.cols[LGK.cur.c] === 'cat') { e.preventDefault(); lgGridEdit(); return; }
        e.preventDefault();
        lgGridEdit(k);
      }
    });
  }

  if (want) {
    const r = LGK.rows.findIndex(el => Number(el.dataset.id) === want.id);
    const c = LGK.cols.indexOf(want.col);
    if (r >= 0 && c >= 0) {
      lgGridSet(r, c, false);
      if (want.move) lgGridMove(want.move === 'down' ? 1 : want.move === 'up' ? -1 : 0,
        want.move === 'right' ? 1 : want.move === 'left' ? -1 : 0, false);
      return;
    }
  }
  LGK.cur = null; LGK.anchor = null;
  lgGridPaint();
}

/* ---------------- 묶은 칸을 한 번에 고치는 바 ----------------
   무엇이 몇 개 잡혔는지 먼저 말하고, 그 다음에 할 수 있는 일을 늘어놓는다.
   한 열만 잡혔으면 '같은 값으로'가 앞에 오고, 여러 열이면 행 단위 손질만 남는다. */
function lgBulkRows() {
  const rng = lgGridRange();
  if (!rng) return [];
  const out = [];
  for (let r = rng.r0; r <= rng.r1; r++) if (LGK.rows[r]) out.push(LGK.rows[r]);
  return out;
}

async function lgBulkApply(ids, patch, msg) {
  if (!ids.length) return;
  const { error } = await (await enClient()).from('transactions').update(patch).in('id', ids);
  if (error) { enToast('저장하지 못했습니다'); return; }
  enToast(msg || `${ids.length}건 고쳤습니다`);
  LGK.cur = null; LGK.anchor = null;
  lgTouched();
  enLoadLedger();
}

function lgBulkPaint() {
  const host = document.querySelector('.lg-wrap');
  const old = document.getElementById('lg-bulk');
  const rng = lgGridRange();
  const many = !!rng && (rng.r0 !== rng.r1 || rng.c0 !== rng.c1);
  if (!many || !host) { if (old) old.remove(); return; }

  const rows = lgBulkRows();
  const ids = rows.map(el => Number(el.dataset.id));
  const cols = [];
  for (let c = rng.c0; c <= rng.c1; c++) if (LGK.vis.includes(c)) cols.push(c);
  const cellCount = rows.length * Math.max(cols.length, 1);
  const one = cols.length === 1 ? LGK.cols[cols[0]] : null;

  const oneHTML = !one ? '' :
    one === 'cat'
      ? `<span class="one"><span class="lab">분류</span><span class="lg-cpick">
           <input class="lg-ed" id="lg-bk-catq" placeholder="분류 검색 → 고르면 바로 적용" autocomplete="off">
           <input type="hidden" id="lg-bk-cat"></span></span>`
      : `<span class="one"><span class="lab">${LGK.labels[one]}</span>
           <input class="lg-ed${one === 'amount' ? ' mono' : ''}" id="lg-bk-val" autocomplete="off"
                  placeholder="${one === 'amount' ? '금액' : one === 'merchant' ? '사용처 (그룹 › 이름)' : '메모 — 비우면 지움'}">
           <button class="go" id="lg-bk-go">적용</button></span>`;

  const html = `
    <span class="n"><b>${rows.length}</b>행 · <b>${cellCount}</b>칸 잡힘</span>
    ${oneHTML}
    <span class="sep"></span>
    <input class="lg-ed" type="date" id="lg-bk-date" title="잡힌 행의 날짜를 한꺼번에">
    <button data-b="company_paid" title="회사 환급 전환">🏢</button>
    <button data-b="Good">GOOD</button>
    <button data-b="Bad">BAD</button>
    <button data-b="gbnull">GOOD/BAD 해제</button>
    <span class="sep"></span>
    <button class="danger" data-b="del">삭제</button>
    <button data-b="close">해제 <span class="kbd">Esc</span></button>`;

  let bar = old;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'lg-bulk';
    bar.id = 'lg-bulk';
    host.appendChild(bar);
  }
  bar.innerHTML = html;

  if (one === 'cat') {
    lgCatPick(bar.querySelector('#lg-bk-catq'), bar.querySelector('#lg-bk-cat'), (c) => {
      lgBulkApply(ids, { category_id: c.id }, `${ids.length}건을 '${c.subcategory}'로 옮겼습니다`);
    });
  } else if (one) {
    const val = bar.querySelector('#lg-bk-val');
    if (one === 'merchant') lgMerchantAC(val);
    if (one === 'amount') val.addEventListener('input', () => {
      const minus = /^\s*[-−]/.test(val.value);
      const raw = val.value.replace(/[^\d]/g, '');
      val.value = raw ? (minus ? '−' : '') + enComma(raw) : (minus ? '−' : '');
    });
    const go = () => {
      const v = val.value.trim();
      if (one === 'amount') {
        const neg = /^[-−]/.test(v);
        const n = Number(v.replace(/[^\d]/g, ''));
        if (!n) { enToast('금액을 적어주세요'); return; }
        lgBulkApply(ids, { amount: neg ? -n : n }, `${ids.length}건의 금액을 맞췄습니다`);
      } else if (one === 'merchant') {
        if (!v) { enToast('사용처를 적어주세요'); return; }
        const p = lgSplitMerchant(v);
        lgBulkApply(ids, { merchant_group: p.group, merchant: p.merchant }, `${ids.length}건의 사용처를 맞췄습니다`);
      } else {
        lgBulkApply(ids, { note: v || null }, v ? `${ids.length}건에 메모를 넣었습니다` : `${ids.length}건의 메모를 지웠습니다`);
      }
    };
    bar.querySelector('#lg-bk-go').addEventListener('click', go);
    val.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); go(); }
    });
  }

  bar.querySelector('#lg-bk-date').addEventListener('change', (e) => {
    const d = e.target.value;
    if (d) lgBulkApply(ids, { date: d }, `${ids.length}건을 ${d.slice(2).replace(/-/g, '.')} 로 옮겼습니다`);
  });

  bar.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.b;
    if (k === 'close') { lgGridClear(); return; }
    if (k === 'del') {
      if (!confirm(`${ids.length}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      const { error } = await (await enClient()).from('transactions').delete().in('id', ids);
      if (error) { enToast('삭제하지 못했습니다'); return; }
      enToast(`${ids.length}건 삭제했습니다`);
      LGK.cur = null; LGK.anchor = null;
      lgTouched();
      enLoadLedger();
      return;
    }
    if (k === 'company_paid') {
      /* 다 켜져 있으면 끄고, 하나라도 꺼져 있으면 모두 켠다 — 결과를 예측할 수 있게 */
      const allOn = rows.every(el => {
        const t = el.querySelector(`[data-tg="${k}"]`);
        return t && t.classList.contains('on');
      });
      const patch = {}; patch[k] = !allOn;
      lgBulkApply(ids, patch, `${ids.length}건 회사 환급 ${allOn ? '해제' : '표시'}했습니다`);
      return;
    }
    /* Good/Bad 는 지출에만 매긴다 */
    const spend = rows.filter(el => el.classList.contains('k-지출')).map(el => Number(el.dataset.id));
    if (!spend.length) { enToast('지출 행에만 매길 수 있어요'); return; }
    const v = k === 'gbnull' ? null : k;
    lgBulkApply(spend, { good_bad: v }, `지출 ${spend.length}건 ${v ? v.toUpperCase() : 'GOOD/BAD 해제'}`);
  }));
}

/* ---------------- 전체 내역 : 표 위에서 행을 여러 개 만들어 한 번에 저장 ----------------
   따로 화면을 만들지 않는다. 목록 맨 위에 빈 행이 쌓이고, 다 채우면 한 번에 넣는다.
   같은 날짜·금액·사용처가 이미 있으면 저장 직전에 알려준다. */

/* 새 기록 행에서 오갈 수 있는 칸 — 화면에 놓인 차례와 같게 둔다 */
const LG_DCOLS = ['date', 'merchant', 'note', 'catq', 'amount'];

function lgDraftRowHTML(i, seed) {
  const c = EN.catById[seed.catId];
  /* 칸 순서 = 생각하는 순서. 어디서 샀나 → 뭘 샀나(메모) → 무슨 갈래인가 → 얼마인가.
     사용처를 먼저 적으면 분류·고정비가 따라오므로 분류 칸은 대개 그냥 지나치고,
     금액이 마지막이라 금액칸 Enter 로 바로 다음 행이 열린다. */
  return `<div class="lg-dr" data-dr="${i}">
    <span class="dt"><input class="lg-ed" type="date" data-d="date" value="${enEsc(seed.date)}" style="color-scheme:dark;"></span>
    <span class="nm"><input class="lg-ed" data-d="merchant" placeholder="사용처" autocomplete="off" value="${enEsc(seed.merchant || '')}"></span>
    <span class="no"><input class="lg-ed" data-d="note" placeholder="메모" autocomplete="off" value="${enEsc(seed.note || '')}"></span>
    <span class="ck"><i class="lg-kd ${c ? c.kind : ''}" data-kd>${c ? c.kind : '—'}</i>
      <span class="lg-cpick">
        <input class="lg-ed" data-d="catq" placeholder="분류 검색" autocomplete="off"
               value="${c ? enEsc(c.category + ' › ' + c.subcategory) : ''}">
        <input type="hidden" data-d="cat" value="${seed.catId || ''}">
      </span></span>
    <span class="am"><input class="lg-ed mono" data-d="amount" inputmode="numeric" placeholder="0" value="${enEsc(seed.amount || '')}"></span>
    <span class="tg">
      <button class="lg-tg ${seed.company_paid ? 'on' : ''}" data-dtg="company_paid" title="회사 환급" tabindex="-1">🏢</button>
    </span>
    <span class="gb"><button class="lg-gb ${c && c.kind !== '지출' ? 'off' : ''} ${seed.good_bad === 'Good' ? 'good' : seed.good_bad === 'Bad' ? 'bad' : ''}" data-dgb tabindex="-1" ${c && c.kind !== '지출' ? 'disabled' : ''}>${seed.good_bad === 'Good' ? 'GOOD' : seed.good_bad === 'Bad' ? 'BAD' : '—'}</button></span>
    <button class="x" data-drx="${i}" aria-label="이 행 삭제" tabindex="-1">×</button>
  </div>`;
}

/* 상단 고정줄의 '＋ 새 행' · '모두 저장' 상태를 초안 개수에 맞춘다 */
function lgSyncAddBtns() {
  const add = document.getElementById('lg-addnew');
  const save = document.getElementById('lg-savetop');
  const n = (EN.draft || []).length;
  if (add) add.innerHTML = `＋ 새 행${n ? ` <b>${n}</b>` : ''}<kbd>A</kbd>`;
  if (save) save.hidden = !n;
}

function lgRenderAdd(focusIdx) {
  const host = document.getElementById('lg-add');
  if (!host) return;
  if (!EN.draft) EN.draft = [];
  /* '＋ 새 행' 은 스크롤해도 안 사라지게 상단 고정줄로 옮겼다 */
  lgSyncAddBtns();
  if (!EN.draft.length) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <div class="lg-addbar">
      <span class="t">새 기록 <b>${EN.draft.length}</b>건</span>
      <span class="hint"><kbd>Enter</kbd> 다음 칸 · 금액에서 <kbd>Enter</kbd> 새 행 ·
        <kbd>Shift</kbd>+<kbd>Enter</kbd> 아무 데서나 새 행 · <kbd>↑↓←→</kbd> 칸 이동 ·
        <kbd>⌘</kbd>+<kbd>D</kbd> 행 복제 · <kbd>⌘</kbd>+<kbd>Enter</kbd> 모두 저장</span>
      <button class="lg-addghost" id="lg-drclear">비우기</button>
      <button class="lg-addghost" id="lg-drmore">+ 행 추가</button>
      <button class="lg-addsave" id="lg-drsave">모두 저장</button>
    </div>
    <div class="lg-drs">${EN.draft.map((d, i) => lgDraftRowHTML(i, d)).join('')}</div>
    <p class="lg-drerr" id="lg-drerr" hidden></p>`;

  host.querySelectorAll('.lg-dr').forEach(row => {
    const hid = row.querySelector('[data-d="cat"]');
    const sync = () => {
      const c = EN.catById[Number(hid.value)];
      const kd = row.querySelector('[data-kd]');
      kd.className = 'lg-kd ' + (c ? c.kind : '');
      kd.textContent = c ? c.kind : '—';
      row.classList.remove('bad');
      /* Good/Bad 는 지출에만 매긴다 */
      const gb = row.querySelector('[data-dgb]');
      const off = !!c && c.kind !== '지출';
      gb.disabled = off;
      gb.classList.toggle('off', off);
      if (off) { gb.className = 'lg-gb off'; gb.textContent = '—'; }
    };
    hid.addEventListener('change', sync);
    lgCatPick(row.querySelector('[data-d="catq"]'), hid, sync);
    sync();
  });

  /* 사용처를 적으면 예전에 쓰던 그룹과 분류가 따라오고, 고정비 사용처면 📌도 같이 켜진다 */
  host.querySelectorAll('[data-d="merchant"]').forEach(inp => {
    const row = inp.closest('.lg-dr');
    const apply = (cid) => {
      const hid = row.querySelector('[data-d="cat"]');
      if (!cid || hid.value) return;
      const c = EN.catById[cid];
      hid.value = String(cid);
      const q = row.querySelector('[data-d="catq"]');
      if (q && c) q.value = c.category + ' › ' + c.subcategory;
      hid.dispatchEvent(new Event('change'));
    };
    lgMerchantAC(inp, (m, cid) => { apply(cid); });
    inp.addEventListener('change', () => {
      const m = lgSplitMerchant(inp.value).merchant;
      apply(EN.merchCat[m]);
    });
  });

  host.querySelectorAll('[data-d="amount"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const t = inp.value;
      const minus = /^\s*[-−]/.test(t);
      const raw = t.replace(/[^\d]/g, '');
      inp.value = raw ? (minus ? '−' : '') + enComma(raw) : (minus ? '−' : '');
    });
  });

  host.querySelectorAll('[data-dtg]').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    b.classList.remove('auto');   /* 손으로 건드린 순간부터는 자동이 아니다 */
  }));
  host.querySelectorAll('[data-dgb]').forEach(b => b.addEventListener('click', () => {
    const cur = b.classList.contains('good') ? 'Good' : b.classList.contains('bad') ? 'Bad' : null;
    const next = cur === null ? 'Good' : cur === 'Good' ? 'Bad' : null;
    b.className = 'lg-gb ' + (next === 'Good' ? 'good' : next === 'Bad' ? 'bad' : '');
    b.textContent = next === 'Good' ? 'GOOD' : next === 'Bad' ? 'BAD' : '—';
  }));

  host.querySelectorAll('[data-drx]').forEach(b => b.addEventListener('click', () => {
    lgDraftSync();
    EN.draft.splice(Number(b.dataset.drx), 1);
    lgRenderAdd();
  }));

  /* 칸 사이를 손대지 않고 돌아다닌다.
     ↑↓ 는 같은 칸의 위·아래 행, ←→ 는 글자 끝에 닿았을 때만 옆 칸으로 — 글자 고치는 걸 막지 않는다. */
  const DCOLS = LG_DCOLS;
  const drFocus = (r, c) => {
    const el = host.querySelector(`.lg-dr[data-dr="${r}"] [data-d="${DCOLS[c]}"]`);
    if (!el || el.type === 'hidden' || el.offsetParent === null) return false;
    el.focus();
    if (el.select) { try { el.select(); } catch (err) {} }
    return true;
  };
  const drStep = (r, c, dr, dc) => {
    const n = host.querySelectorAll('.lg-dr').length;
    let rr = r + dr, cc = c + dc;
    for (let guard = 0; guard < 24; guard++) {
      if (cc < 0) { cc = DCOLS.length - 1; rr--; }
      if (cc > DCOLS.length - 1) { cc = 0; rr++; }
      if (rr < 0 || rr >= n) return false;
      if (drFocus(rr, cc)) return true;
      if (dc) cc += (dc > 0 ? 1 : -1); else return false;
    }
    return false;
  };
  const caretStart = (el) => { try { return el.selectionStart === 0 && el.selectionEnd === 0; } catch (err) { return true; } };
  const caretEnd = (el) => { try { return el.selectionStart === el.value.length && el.selectionEnd === el.value.length; } catch (err) { return true; } };

  /* 칸 안내는 한 번만 건다 — 행을 그릴 때마다 걸면 Enter 한 번에 행이 두세 개씩 생긴다 */
  if (!host.dataset.keys) {
  host.dataset.keys = '1';
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); lgDraftSave(); return; }
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.d) return;
    const row = t.closest('.lg-dr');
    if (!row) return;
    const i = Number(row.dataset.dr);
    const c = DCOLS.indexOf(t.dataset.d);
    if (c < 0) return;

    /* 어디서든 한 번에 새 행 */
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      lgDraftSync();
      const s = EN.draft[i] || {};
      lgDraftAdd(s.date, s.catId);
      return;
    }
    /* 이 행 그대로 한 벌 더 (금액만 비운다) — 같은 가게에서 여러 건 적을 때.
       아직 아무것도 안 쓴 행이면 바로 윗 행을 물려받는다. */
    if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      lgDraftSync();
      const here = EN.draft[i];
      const blank = here && !here.merchant && !here.note && !here.amount;
      const s = (blank && EN.draft[i - 1]) ? EN.draft[i - 1] : here;
      if (!s) return;
      EN.draft.splice(i + 1, 0, { ...s, amount: '' });
      lgRenderAdd(i + 1);
      return;
    }
    /* 자동완성·분류 목록이 이미 가져간 키는 건드리지 않는다 */
    if (e.defaultPrevented) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (t.dataset.d === 'amount') {
        lgDraftSync();
        if (i === EN.draft.length - 1) lgDraftAdd(EN.draft[i].date, EN.draft[i].catId);
        else lgRenderAdd(i + 1);
        return;
      }
      drStep(i, c, 0, 1);
      return;
    }
    if (e.key === 'ArrowDown') { if (drStep(i, c, 1, 0)) e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { if (drStep(i, c, -1, 0)) e.preventDefault(); return; }
    if (e.key === 'ArrowRight' && caretEnd(t)) { if (drStep(i, c, 0, 1)) e.preventDefault(); return; }
    if (e.key === 'ArrowLeft' && caretStart(t)) { if (drStep(i, c, 0, -1)) e.preventDefault(); return; }
    if (e.key === 'Escape') { t.blur(); }
  });
  }

  host.querySelector('#lg-drmore').addEventListener('click', () => {
    lgDraftSync();
    const last = EN.draft[EN.draft.length - 1] || {};
    lgDraftAdd(last.date, last.catId);
  });
  host.querySelector('#lg-drclear').addEventListener('click', () => {
    if (!confirm('작성 중인 행을 모두 버릴까요?')) return;
    EN.draft = [];
    lgRenderAdd();
  });
  host.querySelector('#lg-drsave').addEventListener('click', lgDraftSave);

  const rows = host.querySelectorAll('.lg-dr');
  /* 언제나 사용처부터 — 여기서 분류와 고정비가 따라 붙으니 첫 칸이어야 한다 */
  const target = rows[focusIdx == null ? rows.length - 1 : focusIdx];
  if (target) {
    const nm = target.querySelector('[data-d="merchant"]');
    if (nm) { nm.focus(); try { nm.select(); } catch (err) {} }
  }
}

/* 화면에 적힌 값을 EN.draft 로 되받는다 — 다시 그릴 때 입력이 날아가지 않게 */
function lgDraftSync() {
  const host = document.getElementById('lg-add');
  if (!host || !EN.draft || !EN.draft.length) return;
  host.querySelectorAll('.lg-dr').forEach(row => {
    const i = Number(row.dataset.dr);
    const v = (k) => { const el = row.querySelector(`[data-d="${k}"]`); return el ? el.value : ''; };
    const gb = row.querySelector('[data-dgb]');
    EN.draft[i] = {
      date: v('date') || enToday(),
      catId: Number(v('cat')) || null,
      merchant: v('merchant').trim(),
      note: v('note').trim(),
      amount: v('amount'),
      company_paid: row.querySelector('[data-dtg="company_paid"]').classList.contains('on'),
      good_bad: gb.classList.contains('good') ? 'Good' : gb.classList.contains('bad') ? 'Bad' : null
    };
  });
}

function lgDraftAdd(date, catId) {
  if (!EN.draft) EN.draft = [];
  if (EN.draft.length) lgDraftSync();
  EN.draft.push({
    date: date || (EN.draft.length ? EN.draft[EN.draft.length - 1].date : enToday()),
    catId: catId || null, merchant: '', note: '', amount: '',
    company_paid: false, good_bad: null
  });
  lgRenderAdd();
}

/* 같은 날짜 · 금액 · 사용처가 이미 있는지 — 저장 직전에만 확인한다 */
async function lgDupes(rows) {
  const key = (d, a, m) => `${d}|${a}|${(m || '').trim()}`;
  const dates = [...new Set(rows.map(r => r.date))];
  const out = [];
  const seen = {};
  try {
    const { data } = await (await enClient()).from('v_transactions')
      .select('date,amount,merchant').in('date', dates);
    (data || []).forEach(r => { seen[key(String(r.date), Number(r.amount), r.merchant)] = 'db'; });
  } catch (e) { /* 확인 못 하면 경고 없이 진행한다 — 저장을 막지는 않는다 */ }
  rows.forEach((r, i) => {
    const k = key(r.date, r.amount, r.merchant);
    if (seen[k]) out.push({ i, where: seen[k] });
    seen[k] = seen[k] || 'draft';
  });
  return out;
}

/* 상단 고정줄과 초안 바에 저장 버튼이 둘이고 ⌘⏎ 도 있다. 앞의 저장이 끝나기 전에
   다시 누르면 EN.draft 가 아직 비워지지 않아 같은 기록이 두 번 들어간다. */
async function lgDraftSave() {
  if (lgDraftSave._busy) return;
  lgDraftSave._busy = true;
  const top = document.getElementById('lg-savetop');
  if (top) top.disabled = true;
  try { await lgDraftSaveRun(); }
  finally { lgDraftSave._busy = false; if (top) top.disabled = false; }
}

async function lgDraftSaveRun() {
  lgDraftSync();
  const host = document.getElementById('lg-add');
  const err = document.getElementById('lg-drerr');
  host.querySelectorAll('.lg-dr').forEach(r => r.classList.remove('bad'));

  const rows = [];
  let invalid = 0;
  EN.draft.forEach((d, i) => {
    const neg = /^[-−]/.test(d.amount);
    const n = Number(String(d.amount).replace(/[^\d]/g, ''));
    /* 분류는 직전 행에서 물려받아 이미 채워져 있을 수 있다.
       그러니 '아직 아무것도 안 쓴 행'의 기준은 금액·사용처·메모가 모두 빈 것. */
    const blank = !n && !d.merchant && !d.note;
    if (blank) return;
    if (!d.catId || !n) {
      invalid++;
      const el = host.querySelector(`.lg-dr[data-dr="${i}"]`);
      if (el) el.classList.add('bad');
      return;
    }
    let { group, merchant } = lgSplitMerchant(d.merchant);
    /* 목록에서 고르면 '그룹 › 사용처'로 들어오지만 손으로 적으면 그룹이 없다.
       그대로 저장하면 같은 사용처가 '그룹 있음'과 '그룹 없음' 두 갈래로 갈라져,
       내역과 사용처 화면에서 한 가게가 둘처럼 보인다. 아는 그룹은 물려준다. */
    if (!group && merchant && EN.merchGroup && EN.merchGroup[merchant]) group = EN.merchGroup[merchant];
    rows.push({
      date: d.date, category_id: d.catId, amount: neg ? -n : n,
      merchant_group: group, merchant, note: d.note || null,
      good_bad: d.good_bad, company_paid: d.company_paid
    });
  });

  if (invalid) {
    err.hidden = false;
    err.textContent = `${invalid}건은 분류와 금액이 있어야 저장됩니다. 붉게 표시된 행을 확인하세요.`;
    return;
  }
  if (!rows.length) { err.hidden = false; err.textContent = '저장할 내용이 없습니다.'; return; }
  err.hidden = true;

  const dupes = await lgDupes(rows);
  if (dupes.length) {
    const lines = dupes.slice(0, 6).map(({ i }) => {
      const r = rows[i];
      return `· ${r.date} ${enComma(Math.abs(r.amount))}원 ${r.merchant || ''}`;
    }).join('\n');
    const more = dupes.length > 6 ? `\n… 외 ${dupes.length - 6}건` : '';
    if (!confirm(`같은 날짜 · 금액 · 사용처의 기록이 이미 있습니다.\n\n${lines}${more}\n\n그래도 저장할까요?`)) return;
  }

  const btn = document.getElementById('lg-drsave');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  const { error } = await (await enClient()).from('transactions').insert(rows);
  if (btn) { btn.disabled = false; btn.textContent = '모두 저장'; }
  if (error) { err.hidden = false; err.textContent = '저장하지 못했습니다. 다시 시도하세요.'; return; }

  rows.forEach(r => { if (r.merchant) EN.merchCat[r.merchant] = r.category_id; });
  EN.draft = [];
  lgRenderAdd();
  enToast(`${rows.length}건 기록했습니다`);
  lgTouched();
  enLoadLedger();
}
