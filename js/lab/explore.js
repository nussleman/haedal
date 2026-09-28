/* ═══════════════════════════════════════════════════════════════════════
   실험실 › 돋보기 — 입출금 내역을 조건으로 썰어 보는 탐색기.

   설계 원칙
   1) 데이터는 딱 한 번만 읽는다. 4천 건 남짓이라 통째로 들고 있어도 가볍다.
      이후 모든 필터·집계·정렬은 브라우저 안에서 끝나므로 누르는 즉시 바뀐다.
      PostgREST 는 limit 값과 무관하게 1000행에서 끊기므로 range() 로 이어 읽는다.
   2) 필터 하나 = 버튼 하나. 누르면 그 자리에서 패널이 열리고, 고른 것은
      아래 칩으로 남는다. 칩의 ×로 하나씩, '초기화'로 통째로 푼다.
   3) 지표·차트·내역은 같은 결과 집합 하나만 본다. 따로 계산하지 않는다.
   4) 차트는 읽는 그림이 아니라 누르는 그림이다. 막대를 누르면 그 조건이
      필터로 들어간다 (기간 막대 → 그 기간, 분류·사용처 막대 → 그 항목).
   ═══════════════════════════════════════════════════════════════════════ */

const XP_FLAGS = { fixed: '📌 고정비', company: '🏢 회사환급', good: 'GOOD', bad: 'BAD' };

function xpBlankFilter() {
  return { from: '', to: '', quick: 'ty', kinds: [], cats: [], groups: [], merchants: [],
           min: null, max: null, flags: [], q: '' };
}

const XP = {
  all: null, err: null, loading: false,
  f: xpBlankFilter(),
  view: 'flow',     // flow | cum | cat | merch
  unit: 'auto',     // auto | day | week | month | quarter | year
  sort: 'date_desc',
  limit: 150,
  pop: null
};

/* ---------------- 데이터 ---------------- */

async function xpLoadAll(force) {
  if (XP.all && !force) return;
  XP.err = null;
  const COLS = 'id,date,kind,category,subcategory,emoji_category,amount,' +
               'merchant_group,merchant,note,good_bad,company_paid,is_fixed,category_id';
  const SIZE = 1000;
  const out = [];
  try {
    const sb = await enClient();
    for (let p = 0; p < 50; p++) {
      const { data, error } = await sb.from('v_transactions').select(COLS)
        .order('date', { ascending: false }).order('id', { ascending: false })
        .range(p * SIZE, (p + 1) * SIZE - 1);
      if (error) throw error;
      const chunk = data || [];
      out.push(...chunk);
      if (chunk.length < SIZE) break;
    }
  } catch (e) {
    XP.err = e.message || String(e);
    XP.all = null;
    return;
  }
  XP.all = out.map(r => ({
    id: r.id,
    date: String(r.date),
    kind: String(r.kind || ''),
    cat: String(r.category || ''),
    sub: String(r.subcategory || ''),
    catId: r.category_id == null ? '' : String(r.category_id),
    emoji: r.emoji_category || '',
    amount: Math.abs(Number(r.amount) || 0),
    group: r.merchant_group || '',
    merchant: r.merchant || '',
    note: r.note || '',
    gb: r.good_bad || '',
    company: !!r.company_paid,
    fixed: !!r.is_fixed
  }));
}

/* ---------------- 필터 ----------------
   except 를 주면 그 항목만 빼고 거른다. 패널 안 건수(패싯)를 셀 때 쓴다 —
   '지금 조건에서 이걸 고르면 몇 건인지'가 보여야 고르는 의미가 있다. */
function xpFilter(except) {
  const f = XP.f;
  const rows = XP.all || [];
  const q = f.q.trim().toLowerCase();
  const gb = f.flags.filter(x => x === 'good' || x === 'bad');
  return rows.filter(r => {
    if (except !== 'period') {
      if (f.from && r.date < f.from) return false;
      if (f.to && r.date > f.to) return false;
    }
    if (except !== 'kind' && f.kinds.length && !f.kinds.includes(r.kind)) return false;
    if (except !== 'cat' && f.cats.length && !f.cats.includes(r.catId)) return false;
    if (except !== 'merch') {
      if (f.groups.length && !f.groups.includes(r.group)) return false;
      if (f.merchants.length && !f.merchants.includes(r.merchant)) return false;
    }
    if (except !== 'amt') {
      if (f.min != null && r.amount < f.min) return false;
      if (f.max != null && r.amount > f.max) return false;
    }
    if (except !== 'flag') {
      if (f.flags.includes('fixed') && !r.fixed) return false;
      if (f.flags.includes('company') && !r.company) return false;
      if (gb.length && !gb.some(x => (x === 'good' ? r.gb === 'Good' : r.gb === 'Bad'))) return false;
    }
    if (q) {
      const hay = (r.merchant + r.note + r.group + r.cat + r.sub).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function xpCount(rows, keyFn) {
  const m = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if (k === '' || k == null) return;
    const o = m.get(k) || { n: 0, sum: 0 };
    o.n++; o.sum += r.amount;
    m.set(k, o);
  });
  return m;
}

/* ---------------- 기간 묶음 ---------------- */

function xpAutoUnit(rows) {
  if (!rows.length) return 'month';
  let lo = rows[0].date, hi = rows[0].date;
  rows.forEach(r => { if (r.date < lo) lo = r.date; if (r.date > hi) hi = r.date; });
  const days = Math.round((new Date(hi) - new Date(lo)) / 86400000) + 1;
  if (days <= 45) return 'day';
  if (days <= 140) return 'week';
  if (days <= 900) return 'month';
  if (days <= 2200) return 'quarter';
  return 'year';
}

function xpUnitOf(rows) { return XP.unit === 'auto' ? xpAutoUnit(rows) : XP.unit; }

function xpBucket(date, unit) {
  const s = String(date);
  if (unit === 'day') return s;
  if (unit === 'month') return s.slice(0, 7);
  if (unit === 'year') return s.slice(0, 4);
  if (unit === 'quarter') return s.slice(0, 4) + '-Q' + Math.ceil(Number(s.slice(5, 7)) / 3);
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));          // 월요일 시작
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function xpBucketLabel(key, unit) {
  if (unit === 'day') return key.slice(5).replace('-', '.');
  if (unit === 'week') return key.slice(5).replace('-', '.') + ' 주';
  if (unit === 'month') return key.slice(2).replace('-', '.');
  return key;
}

/* 막대를 눌렀을 때 그 묶음의 시작·끝 날짜 */
function xpBucketRange(key, unit) {
  if (unit === 'day') return [key, key];
  if (unit === 'month') {
    const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
    return [`${key}-01`, `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`];
  }
  if (unit === 'year') return [`${key}-01-01`, `${key}-12-31`];
  if (unit === 'quarter') {
    const y = Number(key.slice(0, 4)), q = Number(key.slice(6));
    const s = new Date(y, (q - 1) * 3, 1), e = new Date(y, q * 3, 0);
    return [xpISO(s), xpISO(e)];
  }
  const d = new Date(key + 'T00:00:00'); const e = new Date(d); e.setDate(e.getDate() + 6);
  return [key, xpISO(e)];
}
function xpISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/* ---------------- 화면 ---------------- */

async function renderExplorePage(body) {
  body.innerHTML = '<div class="xp"><div class="en-empty">내역을 불러오는 중…</div></div>';
  await xpLoadAll();
  if (XP.err) {
    body.innerHTML = `<div class="xp"><div class="en-empty">내역을 불러오지 못했습니다 — ${enEsc(XP.err)}</div></div>`;
    return;
  }
  if (XP.f.quick && !XP.f.from && !XP.f.to) {
    const [a, b] = enQuickRange(XP.f.quick);
    XP.f.from = a; XP.f.to = b;
  }

  body.innerHTML = `
    <div class="xp">
      <div class="xp-bar">
        <button class="xp-fb" data-pop="period">기간<i>▾</i></button>
        <button class="xp-fb" data-pop="kind">종류<i>▾</i></button>
        <button class="xp-fb" data-pop="cat">분류<i>▾</i></button>
        <button class="xp-fb" data-pop="merch">사용처<i>▾</i></button>
        <button class="xp-fb" data-pop="amt">금액<i>▾</i></button>
        <button class="xp-fb" data-pop="flag">표시<i>▾</i></button>
        <input class="xp-q" id="xp-q" placeholder="사용처 · 메모 · 분류에서 찾기" value="${enEsc(XP.f.q)}">
        <button class="xp-clear" id="xp-clear">초기화</button>
      </div>
      <div class="xp-chips" id="xp-chips"></div>

      <div class="stat-grid xp-cards" id="xp-cards"></div>

      <div class="panel xp-panel">
        <div class="xp-hd">
          <b>추이</b>
          <span class="xp-seg" id="xp-view">
            <button data-v="flow">수입·지출</button><button data-v="cum">누적 순액</button>
            <button data-v="cat">분류별</button><button data-v="merch">사용처별</button>
          </span>
          <span class="xp-seg" id="xp-unit">
            <button data-u="auto">자동</button><button data-u="day">일</button><button data-u="week">주</button>
            <button data-u="month">월</button><button data-u="quarter">분기</button><button data-u="year">연</button>
          </span>
          <span class="xp-hint" id="xp-hint"></span>
        </div>
        <div class="xp-canvas"><canvas id="xp-chart"></canvas></div>
      </div>

      <div class="panel xp-panel">
        <div class="xp-hd">
          <b>내역</b>
          <span class="ptag" id="xp-count"></span>
          <select class="en-in xp-sort" id="xp-sort">
            <option value="date_desc">최신순</option><option value="date_asc">오래된순</option>
            <option value="amt_desc">금액 큰 순</option><option value="amt_asc">금액 작은 순</option>
          </select>
        </div>
        <div class="xp-cols">
          <span>날짜</span><span>종류</span><span>분류</span><span>사용처</span>
          <span>메모</span><span class="ct">표시</span><span class="rt">금액</span>
        </div>
        <div id="xp-list"></div>
        <div class="xp-more"><button class="btn small" id="xp-more" hidden>더 보기</button></div>
      </div>

      <div class="xp-pop" id="xp-pop" hidden></div>
    </div>`;

  enQS('#xp-sort').value = XP.sort;
  xpBind();
  xpPaint();
}

function xpBind() {
  const root = document.querySelector('.xp');
  if (!root) return;
  /* 화면 밖 클릭·Esc 로 팝오버를 닫는다. 화면을 다시 그려도 한 번만 건다. */
  if (!XP.bound) {
    XP.bound = true;
    document.addEventListener('mousedown', (e) => {
      if (!XP.pop) return;
      if (e.target.closest('.xp-pop') || e.target.closest('.xp-fb')) return;
      xpPopClose();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') xpPopClose(); });
  }

  root.addEventListener('click', (e) => {
    const fb = e.target.closest('.xp-fb');
    if (fb) { xpPopToggle(fb); return; }
    if (!e.target.closest('.xp-pop')) xpPopClose();

    const v = e.target.closest('#xp-view button');
    if (v) { XP.view = v.dataset.v; xpPaint(); return; }
    const u = e.target.closest('#xp-unit button');
    if (u) { XP.unit = u.dataset.u; xpPaint(); return; }
    const chip = e.target.closest('.xp-chip[data-drop]');
    if (chip) { xpDropChip(chip.dataset.drop, chip.dataset.val); xpPaint(); return; }
    if (e.target.closest('#xp-clear')) { XP.f = xpBlankFilter(); XP.limit = 150; const [a, b] = enQuickRange(XP.f.quick); XP.f.from = a; XP.f.to = b; const q = enQS('#xp-q'); if (q) q.value = ''; xpPaint(); return; }
    if (e.target.closest('#xp-more')) { XP.limit += 150; xpPaintList(); return; }
    const cell = e.target.closest('.xp-row [data-add]');
    if (cell) { xpToggleVal(cell.dataset.add, cell.dataset.val); xpPaint(); return; }
  });

  let t = null;
  enQS('#xp-q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { XP.f.q = e.target.value.trim(); XP.limit = 150; xpPaint(); }, 220);
  });
  enQS('#xp-sort').addEventListener('change', (e) => { XP.sort = e.target.value; xpPaintList(); });
}

function xpToggleVal(key, val) {
  const arr = XP.f[key];
  if (!Array.isArray(arr)) return;
  const i = arr.indexOf(val);
  if (i >= 0) arr.splice(i, 1); else arr.push(val);
  XP.limit = 150;
}
function xpDropChip(key, val) {
  if (key === 'period') { XP.f.from = ''; XP.f.to = ''; XP.f.quick = ''; }
  else if (key === 'amt') { XP.f.min = null; XP.f.max = null; }
  else if (key === 'q') { XP.f.q = ''; const el = enQS('#xp-q'); if (el) el.value = ''; }
  else xpToggleVal(key, val);
  XP.limit = 150;
}

/* ---------------- 팝오버 ---------------- */

function xpPopClose() {
  const p = enQS('#xp-pop');
  if (p) { p.hidden = true; p.innerHTML = ''; }
  document.querySelectorAll('.xp-fb.on').forEach(b => b.classList.remove('on'));
  XP.pop = null;
}

function xpPopToggle(btn) {
  const name = btn.dataset.pop;
  if (XP.pop === name) { xpPopClose(); return; }
  xpPopClose();
  XP.pop = name;
  btn.classList.add('on');
  const pop = enQS('#xp-pop');
  pop.innerHTML = xpPanelHtml(name);
  pop.hidden = false;
  const br = btn.getBoundingClientRect();
  const wr = document.querySelector('.xp').getBoundingClientRect();
  pop.style.top = (br.bottom - wr.top + 6) + 'px';
  pop.style.left = Math.max(0, Math.min(br.left - wr.left, wr.width - pop.offsetWidth - 4)) + 'px';
  xpPanelBind(name, pop);
}

function xpPanelHtml(name) {
  const f = XP.f;
  if (name === 'period') {
    const qb = [['tm', '이번달'], ['lm', '지난달'], ['3m', '최근 3개월'], ['ty', '올해'], ['all', '전체']];
    return `<div class="xp-pg"><span class="xp-plab">빠른 선택</span>
      <div class="xp-quick">${qb.map(([k, l]) => `<button data-q="${k}" class="${f.quick === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="xp-pg"><span class="xp-plab">직접 고르기</span>
      <div class="xp-row2"><input type="date" class="en-in" id="xp-from" value="${f.from}">
      <span class="xp-tilde">~</span><input type="date" class="en-in" id="xp-to" value="${f.to}"></div></div>`;
  }
  if (name === 'kind') {
    const c = xpCount(xpFilter('kind'), r => r.kind);
    return `<div class="xp-pg"><span class="xp-plab">종류</span><div class="xp-opts">` +
      ['지출', '수입', '이체'].map(k => xpOpt('kinds', k, `<i class="lg-kd ${k}">${k}</i>`, c.get(k))).join('') +
      `</div></div>`;
  }
  if (name === 'cat') {
    const rows = xpFilter('cat');
    const c = xpCount(rows, r => r.catId);
    const meta = {};
    (XP.all || []).forEach(r => { if (r.catId && !meta[r.catId]) meta[r.catId] = r; });
    const list = Object.keys(meta)
      .map(id => ({ id, r: meta[id], n: (c.get(id) || {}).n || 0, sum: (c.get(id) || {}).sum || 0 }))
      .sort((a, b) => b.sum - a.sum || a.r.cat.localeCompare(b.r.cat));
    return `<div class="xp-pg"><input class="en-in xp-search" id="xp-psearch" placeholder="분류 찾기" autocomplete="off"></div>
      <div class="xp-opts scroll" id="xp-plist">` +
      list.map(o => xpOpt('cats', o.id, `${o.r.emoji || ''} ${enEsc(o.r.cat)} › ${enEsc(o.r.sub)}`, { n: o.n, sum: o.sum })).join('') +
      `</div>`;
  }
  if (name === 'merch') {
    const rows = xpFilter('merch');
    const cg = xpCount(rows, r => r.group);
    const cm = xpCount(rows, r => r.merchant);
    const gs = [...cg.entries()].sort((a, b) => b[1].sum - a[1].sum);
    const ms = [...cm.entries()].sort((a, b) => b[1].sum - a[1].sum);
    return `<div class="xp-pg"><input class="en-in xp-search" id="xp-psearch" placeholder="사용처 · 묶음 찾기" autocomplete="off"></div>
      <div class="xp-opts scroll" id="xp-plist">
        ${gs.length ? `<div class="xp-osec">묶음</div>` + gs.map(([g, o]) => xpOpt('groups', g, `<i class="lg-mg">${enEsc(g)}</i>`, o)).join('') : ''}
        <div class="xp-osec">사용처</div>
        ${ms.map(([m, o]) => xpOpt('merchants', m, enEsc(m), o)).join('')}
      </div>`;
  }
  if (name === 'amt') {
    const presets = [[10000, null, '1만↑'], [50000, null, '5만↑'], [100000, null, '10만↑'], [500000, null, '50만↑'], [null, 10000, '1만↓']];
    return `<div class="xp-pg"><span class="xp-plab">금액 범위 (원)</span>
      <div class="xp-row2"><input class="en-in" id="xp-min" inputmode="numeric" placeholder="최소" value="${f.min == null ? '' : f.min}">
      <span class="xp-tilde">~</span><input class="en-in" id="xp-max" inputmode="numeric" placeholder="최대" value="${f.max == null ? '' : f.max}"></div></div>
      <div class="xp-pg"><span class="xp-plab">빠른 선택</span><div class="xp-quick">${
        presets.map(([a, b, l]) => `<button data-min="${a == null ? '' : a}" data-max="${b == null ? '' : b}">${l}</button>`).join('')}</div></div>`;
  }
  if (name === 'flag') {
    const c = xpFilter('flag');
    const n = {
      fixed: c.filter(r => r.fixed).length, company: c.filter(r => r.company).length,
      good: c.filter(r => r.gb === 'Good').length, bad: c.filter(r => r.gb === 'Bad').length
    };
    return `<div class="xp-pg"><span class="xp-plab">표시</span><div class="xp-opts">` +
      Object.keys(XP_FLAGS).map(k => xpOpt('flags', k, XP_FLAGS[k], { n: n[k], sum: null })).join('') +
      `</div></div>`;
  }
  return '';
}

function xpOpt(key, val, label, o) {
  const on = (XP.f[key] || []).includes(val);
  const n = o ? o.n : 0;
  const sum = o && o.sum != null ? `<em>${formatCompactWon(o.sum)}</em>` : '';
  return `<button class="xp-opt${on ? ' on' : ''}" data-key="${key}" data-val="${enEsc(val)}" data-txt="${enEsc(String(label).replace(/<[^>]*>/g, ''))}">
    <span class="bx">${on ? '✓' : ''}</span><span class="lb">${label}</span><span class="ct">${n}${sum}</span></button>`;
}

function xpPanelBind(name, pop) {
  pop.querySelectorAll('.xp-opt').forEach(b => b.addEventListener('click', () => {
    xpToggleVal(b.dataset.key, b.dataset.val);
    const on = (XP.f[b.dataset.key] || []).includes(b.dataset.val);
    b.classList.toggle('on', on);
    b.querySelector('.bx').textContent = on ? '✓' : '';
    xpPaint(true);
  }));

  const search = pop.querySelector('#xp-psearch');
  if (search) {
    search.focus();
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      pop.querySelectorAll('#xp-plist .xp-opt').forEach(b => {
        b.hidden = !!q && !(b.dataset.txt + ' ' + b.dataset.val).toLowerCase().includes(q);
      });
      pop.querySelectorAll('.xp-osec').forEach(s => {
        let el = s.nextElementSibling, any = false;
        while (el && el.classList.contains('xp-opt')) { if (!el.hidden) { any = true; break; } el = el.nextElementSibling; }
        s.hidden = !any;
      });
    });
  }

  if (name === 'period') {
    pop.querySelectorAll('.xp-quick button').forEach(b => b.addEventListener('click', () => {
      XP.f.quick = b.dataset.q;
      const [a, c] = enQuickRange(b.dataset.q);
      XP.f.from = a; XP.f.to = c; XP.limit = 150;
      pop.querySelectorAll('.xp-quick button').forEach(x => x.classList.toggle('on', x === b));
      const fi = pop.querySelector('#xp-from'), ti = pop.querySelector('#xp-to');
      if (fi) fi.value = a; if (ti) ti.value = c;
      xpPaint(true);
    }));
    const apply = () => {
      XP.f.from = pop.querySelector('#xp-from').value;
      XP.f.to = pop.querySelector('#xp-to').value;
      XP.f.quick = ''; XP.limit = 150;
      pop.querySelectorAll('.xp-quick button').forEach(x => x.classList.remove('on'));
      xpPaint(true);
    };
    pop.querySelector('#xp-from').addEventListener('change', apply);
    pop.querySelector('#xp-to').addEventListener('change', apply);
  }

  if (name === 'amt') {
    const rd = (el) => { const v = String(el.value).replace(/[^0-9]/g, ''); return v === '' ? null : Number(v); };
    const apply = () => {
      XP.f.min = rd(pop.querySelector('#xp-min'));
      XP.f.max = rd(pop.querySelector('#xp-max'));
      XP.limit = 150; xpPaint(true);
    };
    pop.querySelector('#xp-min').addEventListener('change', apply);
    pop.querySelector('#xp-max').addEventListener('change', apply);
    pop.querySelectorAll('.xp-quick button').forEach(b => b.addEventListener('click', () => {
      pop.querySelector('#xp-min').value = b.dataset.min;
      pop.querySelector('#xp-max').value = b.dataset.max;
      apply();
    }));
  }
}

/* ---------------- 그리기 ---------------- */

function xpPaint(keepPop) {
  if (!document.querySelector('.xp')) return;
  const rows = xpFilter();
  xpPaintChips();
  xpPaintCards(rows);
  xpPaintChart(rows);
  xpPaintList(rows);
  document.querySelectorAll('#xp-view button').forEach(b => b.classList.toggle('on', b.dataset.v === XP.view));
  document.querySelectorAll('#xp-unit button').forEach(b => b.classList.toggle('on', b.dataset.u === XP.unit));
  const unitOn = XP.view === 'flow' || XP.view === 'cum';
  const seg = enQS('#xp-unit'); if (seg) seg.style.display = unitOn ? '' : 'none';
  if (!keepPop) xpPopClose();
}

function xpPaintChips() {
  const box = enQS('#xp-chips');
  if (!box) return;
  const f = XP.f;
  const chips = [];
  const add = (key, val, txt) => chips.push(
    `<button class="xp-chip" data-drop="${key}" data-val="${enEsc(val)}">${enEsc(txt)}<i>×</i></button>`);

  if (f.from || f.to) add('period', '', `${f.from || '처음'} ~ ${f.to || '지금'}`);
  f.kinds.forEach(k => add('kinds', k, k));
  const meta = {};
  (XP.all || []).forEach(r => { if (r.catId && !meta[r.catId]) meta[r.catId] = r; });
  f.cats.forEach(id => add('cats', id, meta[id] ? `${meta[id].cat} › ${meta[id].sub}` : id));
  f.groups.forEach(g => add('groups', g, `묶음 ${g}`));
  f.merchants.forEach(m => add('merchants', m, m));
  if (f.min != null || f.max != null)
    add('amt', '', `${f.min != null ? wonComma(f.min) : '0'} ~ ${f.max != null ? wonComma(f.max) : '∞'}원`);
  f.flags.forEach(k => add('flags', k, XP_FLAGS[k]));
  if (f.q) add('q', '', `"${f.q}"`);

  box.innerHTML = chips.length
    ? chips.join('')
    : '<span class="xp-nochip">조건을 걸지 않았어요. 위 버튼으로 기간·분류·사용처를 좁혀보세요.</span>';
  document.querySelectorAll('.xp-fb').forEach(b => {
    const k = b.dataset.pop;
    const has = k === 'period' ? !!(f.from || f.to)
      : k === 'kind' ? f.kinds.length
      : k === 'cat' ? f.cats.length
      : k === 'merch' ? (f.groups.length + f.merchants.length)
      : k === 'amt' ? (f.min != null || f.max != null)
      : f.flags.length;
    b.classList.toggle('has', !!has);
  });
}

function xpPaintCards(rows) {
  const box = enQS('#xp-cards');
  if (!box) return;
  const sum = (k) => rows.filter(r => r.kind === k).reduce((a, r) => a + r.amount, 0);
  const inc = sum('수입'), exp = sum('지출'), tr = sum('이체');
  const net = inc - exp;
  const expRows = rows.filter(r => r.kind === '지출');
  const months = new Set(rows.map(r => r.date.slice(0, 7))).size || 1;
  const card = (label, value, sub, color) =>
    `<div class="stat-card"><div class="label">${label}</div>
      <div class="value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      <div class="sub">${sub}</div></div>`;

  box.innerHTML =
    card('건수', `${wonComma(rows.length)}건`, `${months}개월에 걸쳐 있어요`) +
    card('지출', formatKrw(exp), `${expRows.length}건 · 건당 ${expRows.length ? formatKrw(exp / expRows.length) : '—'}`, 'var(--expense-text)') +
    card('수입', formatKrw(inc), `이체 ${formatKrw(tr)} 별도`, 'var(--income-text)') +
    card('순액', (net >= 0 ? '+' : '') + formatKrw(net), '수입 − 지출', net >= 0 ? 'var(--income-text)' : 'var(--expense-text)') +
    card('월평균 지출', formatKrw(exp / months), `${months}개월 기준`, 'var(--net-text)');
}

function xpPaintChart(rows) {
  const cv = document.getElementById('xp-chart');
  if (!cv) return;
  if (state.charts.xp) { try { state.charts.xp.destroy(); } catch (e) {} state.charts.xp = null; }
  const hint = enQS('#xp-hint');
  if (!rows.length) { if (hint) hint.textContent = '조건에 맞는 기록이 없어요.'; return; }

  if (XP.view === 'cat' || XP.view === 'merch') {
    const isCat = XP.view === 'cat';
    const base = rows.filter(r => r.kind !== '이체');
    const m = xpCount(base, r => isCat ? r.catId : r.merchant);
    const meta = {};
    (XP.all || []).forEach(r => { if (r.catId && !meta[r.catId]) meta[r.catId] = r; });
    const top = [...m.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 14);
    const labels = top.map(([k]) => isCat ? (meta[k] ? `${meta[k].cat} › ${meta[k].sub}` : k) : k);
    if (hint) hint.textContent = `큰 순 ${top.length}개 · 막대를 누르면 그 항목만 봅니다`;
    state.charts.xp = new Chart(cv, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '금액', data: top.map(([, o]) => o.sum), backgroundColor: 'rgba(201,162,39,0.65)', borderRadius: 3 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 14 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${formatWon(c.raw)} · ${top[c.dataIndex][1].n}건` } }
        },
        scales: {
          x: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
          y: { ticks: { color: '#c3cad8', font: { size: 11 } }, grid: { display: false } }
        },
        onClick: (evt, els) => {
          if (!els.length) return;
          const k = top[els[0].index][0];
          xpToggleVal(isCat ? 'cats' : 'merchants', k);
          xpPaint();
        }
      }
    });
    return;
  }

  const unit = xpUnitOf(rows);
  const keys = [...new Set(rows.map(r => xpBucket(r.date, unit)))].sort();
  const pick = (k, kind) => rows.filter(r => xpBucket(r.date, unit) === k && r.kind === kind)
    .reduce((a, r) => a + r.amount, 0);
  const inc = keys.map(k => pick(k, '수입'));
  const exp = keys.map(k => pick(k, '지출'));
  const labels = keys.map(k => xpBucketLabel(k, unit));
  const unitName = { day: '일', week: '주', month: '월', quarter: '분기', year: '연' }[unit];
  if (hint) hint.textContent = `${unitName} 단위 ${keys.length}칸 · 막대를 누르면 그 기간만 봅니다`;

  if (XP.view === 'cum') {
    let acc = 0;
    const cum = keys.map((k, i) => (acc += inc[i] - exp[i]));
    state.charts.xp = new Chart(cv, {
      type: 'line',
      data: { labels, datasets: [{ label: '누적 순액', data: cum, borderColor: '#9b7fc2', backgroundColor: 'rgba(155,127,194,0.14)', fill: true, tension: 0.25, pointRadius: keys.length > 40 ? 0 : 2, borderWidth: 2.5 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` 누적 ${formatWon(c.raw)}` } } },
        scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } },
        onClick: (evt, els) => { if (els.length) xpZoomBucket(keys[els[0].index], unit); }
      }
    });
    return;
  }

  state.charts.xp = new Chart(cv, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: '수입', data: inc, backgroundColor: 'rgba(76,140,107,0.75)', borderRadius: 3, order: 3 },
        { type: 'bar', label: '지출', data: exp, backgroundColor: 'rgba(193,72,63,0.75)', borderRadius: 3, order: 3 },
        { type: 'line', label: '순액', data: keys.map((k, i) => inc[i] - exp[i]), borderColor: '#9b7fc2', backgroundColor: 'transparent', tension: 0.25, pointRadius: keys.length > 40 ? 0 : 2, borderWidth: 2.5, order: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: '#a9b2c4', boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } }
      },
      scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } },
      onClick: (evt, els) => { if (els.length) xpZoomBucket(keys[els[0].index], unit); }
    }
  });
}

function xpZoomBucket(key, unit) {
  const [a, b] = xpBucketRange(key, unit);
  XP.f.from = a; XP.f.to = b; XP.f.quick = '';
  XP.unit = unit === 'day' ? 'day' : 'auto';
  XP.limit = 150;
  xpPaint();
}

function xpPaintList(rowsIn) {
  const box = enQS('#xp-list');
  if (!box) return;
  const rows = rowsIn || xpFilter();
  const s = XP.sort;
  const sorted = [...rows].sort((a, b) =>
    s === 'date_asc' ? (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)
      : s === 'amt_desc' ? b.amount - a.amount
        : s === 'amt_asc' ? a.amount - b.amount
          : (a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id));
  const show = sorted.slice(0, XP.limit);

  const cnt = enQS('#xp-count');
  if (cnt) cnt.textContent = `${wonComma(rows.length)}건 중 ${wonComma(show.length)}건 표시`;
  const more = enQS('#xp-more');
  if (more) more.hidden = show.length >= sorted.length;

  if (!show.length) {
    box.innerHTML = '<div class="en-empty">조건에 맞는 기록이 없어요. 필터를 조금 풀어보세요.</div>';
    return;
  }
  box.innerHTML = show.map(r => `<div class="xp-row k-${r.kind}">
    <span class="dt">${r.date.slice(2).replace(/-/g, '.')}</span>
    <span class="kd"><i class="lg-kd ${r.kind}">${r.kind}</i></span>
    <span class="ca" data-add="cats" data-val="${enEsc(r.catId)}" title="이 분류만 보기">${r.emoji || ''} ${enEsc(r.cat)} › ${enEsc(r.sub)}</span>
    <span class="mc" data-add="merchants" data-val="${enEsc(r.merchant)}" title="이 사용처만 보기">${
      r.group ? `<i class="lg-mg">${enEsc(r.group)}</i>` : ''}${enEsc(r.merchant || r.sub)}</span>
    <span class="nt">${r.note ? enEsc(r.note) : '<i class="lg-ph">—</i>'}</span>
    <span class="fl">${r.fixed ? '📌' : ''}${r.company ? '🏢' : ''}${
      r.gb === 'Good' ? '<b class="g">G</b>' : r.gb === 'Bad' ? '<b class="b">B</b>' : ''}</span>
    <span class="am ${r.kind}">${wonComma(r.amount)}</span>
  </div>`).join('');
}
