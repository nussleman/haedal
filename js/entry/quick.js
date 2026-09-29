/* ================= 빠른 기록 (폰) =================
   예전 폰 전용 앱(gagyebu.html)의 입력 방식을 본 사이트로 옮겼다.
   한 번에 한 칸씩 — 사용처 → 분류 → 금액 → 날짜 — 을 묻는다.
   키보드가 필요한 칸(사용처·메모)은 화면 위쪽에 두어 키보드에 가리지 않게 하고,
   누르기만 하는 것(분류·금액 키패드·저장)은 엄지가 닿는 아래쪽에 둔다.
   사용처를 고르면 지난번 분류가 따라오고, 그 사용처에서 자주 찍은 금액이 버튼으로 뜬다.
   폰에서 '＋ 기록' 을 누르거나 #quick 주소로 들어오면 열린다. */

const QE_STEPS = ['사용처', '분류', '금액', '날짜'];
const QE = { open: false, loaded: false, cats: [], allCats: [], merchants: [], stats: {}, d: null, saved: 0 };

const qeEsc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qeComma = (n) => (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR');
function qeDay(n) {
  const dt = new Date();
  dt.setDate(dt.getDate() + (n || 0));
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 10);
}
function qeDateLabel(k) {
  if (k === qeDay(0)) return '오늘';
  if (k === qeDay(-1)) return '어제';
  if (k === qeDay(-2)) return '그저께';
  const d = new Date(k + 'T00:00:00');
  return `${+k.slice(5, 7)}월 ${+k.slice(8, 10)}일 (${'일월화수목금토'[d.getDay()]})`;
}
function qeFresh() {
  return { step: 1, reach: 1, kind: '지출', amount: '', neg: false, catId: null, cat: null,
    merchant: '', noMerch: false, note: '', date: qeDay(0),
    good: null, fixed: false, co: false, focus: true };
}
/* 폰(좁은 화면)에서만 이 화면을 쓴다. PC 는 기존 기록 창 */
function qeWanted() { return window.matchMedia('(max-width: 640px)').matches; }

const qeCat = (id) => QE.cats.find(x => x.id === id) || QE.allCats.find(x => x.id === id);
const qeCatLabel = (id) => { const c = qeCat(id); return c ? `${c.category} › ${c.subcategory}` : '분류 없음'; };
const qeMerch = (name) => QE.merchants.find(x => x.name === name);

let QE_LOADING = null;
/* 앱 화면은 시작할 때 미리 불러 둔다 — 기록 버튼을 누르자마자 바로 뜨게 */
function qeLoad() {
  if (!QE_LOADING) QE_LOADING = qeLoadRun().catch((e) => { QE_LOADING = null; throw e; });
  return QE_LOADING;
}
async function qeLoadRun() {
  const c = await haedalSupabase();
  const [cats, merch, recent] = await Promise.all([
    c.from('categories').select('id,kind,category,subcategory,emoji_kind,emoji_category,sort_order,is_active').order('sort_order'),
    c.from('merchants').select('id,name,merchant_group,is_fixed').order('name'),
    c.from('transactions').select('merchant,category_id,date,amount').not('merchant', 'is', null)
      .order('date', { ascending: false }).limit(1200)
  ]);
  if (cats.error) throw new Error(cats.error.message);
  QE.allCats = cats.data || [];
  QE.cats = QE.allCats.filter(x => x.is_active !== false);
  QE.merchants = merch.data || [];
  /* 사용처별: 몇 번 썼나, 가장 많이 쓴 분류, 자주 찍은 금액 */
  const st = {};
  (recent.data || []).forEach(r => {
    const n = (r.merchant || '').trim();
    if (!n) return;
    const o = st[n] || (st[n] = { name: n, count: 0, catCnt: {}, catId: null, amounts: [] });
    o.count++;
    if (r.category_id) o.catCnt[r.category_id] = (o.catCnt[r.category_id] || 0) + 1;
    const a = Math.abs(Number(r.amount) || 0);
    if (a) o.amounts.push(a);
  });
  Object.values(st).forEach(o => {
    let best = null, n = -1;
    Object.keys(o.catCnt).forEach(cid => { if (o.catCnt[cid] > n) { n = o.catCnt[cid]; best = Number(cid); } });
    o.catId = best;
  });
  QE.merchants.forEach(x => { if (!st[x.name]) st[x.name] = { name: x.name, count: 0, catCnt: {}, catId: null, amounts: [] }; });
  QE.stats = st;
  QE.loaded = true;
}

function qeRoot() {
  let el = document.getElementById('qe');
  if (!el) {
    el = document.createElement('div');
    el.id = 'qe';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

/* ---------------- 키보드 · 화면 높이 ----------------
   아이폰은 키보드가 올라와도 화면(레이아웃) 높이가 그대로라, 아래에 붙인 것이 키보드 뒤로 숨는다.
   실제로 보이는 영역(visualViewport)의 높이·위치를 CSS 변수로 알려 주고,
   기록 화면·수정 시트는 그 영역 안에만 그린다. 입력칸에 커서가 있으면 body.kb-on. */
function qeFitViewport() {
  const vv = window.visualViewport;
  const r = document.documentElement.style;
  r.setProperty('--vvh', (vv ? vv.height : window.innerHeight) + 'px');
  r.setProperty('--vvt', (vv ? vv.offsetTop : 0) + 'px');
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', qeFitViewport);
  window.visualViewport.addEventListener('scroll', qeFitViewport);
}
window.addEventListener('resize', qeFitViewport);
const qeTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|range|color|file)$/i.test(el.type)));
document.addEventListener('focusin', (e) => {
  if (!qeTyping(e.target)) return;
  document.body.classList.add('kb-on');
  /* 키보드가 다 올라온 뒤, 커서 있는 칸이 가려져 있으면 보이게 끈다 */
  const t = e.target;
  setTimeout(() => { qeFitViewport(); if (document.activeElement === t && t.closest('#qe, #ap-sheet')) t.scrollIntoView({ block: 'nearest' }); }, 320);
});
document.addEventListener('focusout', () => {
  setTimeout(() => { if (!qeTyping(document.activeElement)) { document.body.classList.remove('kb-on'); qeFitViewport(); } }, 80);
});

/* 기록 화면·시트가 떠 있는 동안 뒤 화면이 같이 밀리지 않게 한다.
   (body 를 position:fixed 로 묶으면 아이폰에서 아래 탭바 같은 고정 요소 위치가 틀어진다 — overflow 만 막는다) */
function qeLockSync() {
  const on = document.body.classList.contains('qe-on') || document.body.classList.contains('ap-sheet-on');
  document.documentElement.classList.toggle('qe-lock', on);
}

async function qeOpen() {
  const el = qeRoot();
  if (QE.open && QE.d) return;
  QE.open = true;
  QE.saved = 0;
  el.hidden = false;
  document.body.classList.add('qe-on');
  qeLockSync();
  qeFitViewport();
  el.innerHTML = `<div class="qe-top"><b>기록</b><span class="qe-cnt" id="qe-cnt"></span><span class="sp"></span>
      <button class="qe-x" id="qe-x" aria-label="닫기">닫기</button></div>
    <div class="qe-main"></div><div class="qe-dock"></div>`;
  el.querySelector('#qe-x').addEventListener('click', qeClose);
  if (typeof apQeChanged === 'function') apQeChanged();
  /* 사용처 칸은 불러오기를 기다리지 않고 바로 그리고 커서를 준다 —
     아이폰은 누른 그 순간(같은 손길) 안에서 커서를 줘야 키보드가 올라온다 */
  QE.d = qeFresh();
  qePaint();
  if (!QE.loaded) {
    try { await qeLoad(); } catch (e) {
      const er = document.getElementById('qe-err');
      if (er) er.textContent = '사용처·분류를 불러오지 못했어요 — ' + (e.message || e);
      return;
    }
    if (QE.open && QE.d && QE.d.step === 1) qeSugs();
  }
}

function qeClose() {
  const el = document.getElementById('qe');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  QE.open = false;
  QE.d = null;
  /* 탭바를 먼저 제자리로 돌려놓고 기록 화면을 비운다 */
  if (typeof apQeChanged === 'function') apQeChanged();
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('qe-on', 'kb-on');
  qeLockSync();
  /* 새로 넣은 기록이 홈·내역 숫자에 바로 반영되게 다시 읽는다 */
  if (QE.saved && typeof fetchLive === 'function') fetchLive(false, Promise.resolve());
}

/* 이미 고른 칸들의 한 줄 요약 — 누르면 그 칸으로 돌아간다 */
function qeRowHTML(i, val) {
  const n = i + 1;
  const filled = !!val[i];
  return `<button class="qe-row" data-s="${n}"><span class="k">${QE_STEPS[i]}</span>
    <span class="v${i === 2 ? ' num' : ''}${filled ? '' : ' ph'}">${qeEsc(filled ? val[i] : '—')}</span><span class="ed">바꾸기</span></button>`;
}

function qePaint() {
  const el = document.getElementById('qe');
  if (!el || el.hidden || !QE.d) return;
  const m = el.querySelector('.qe-main');
  const dock = el.querySelector('.qe-dock');
  const d = QE.d;
  d.reach = Math.max(d.reach || 1, d.step);
  const val = [
    d.noMerch ? '사용처 없음' : d.merchant.trim(),
    d.catId ? qeCatLabel(d.catId) : '',
    d.amount ? qeComma(d.neg ? -Number(d.amount) : Number(d.amount)) + '원' : '',
    qeDateLabel(d.date)
  ];
  const before = [], after = [];
  for (let i = 0; i < d.reach; i++) {
    if (i + 1 < d.step) before.push(qeRowHTML(i, val));
    else if (i + 1 > d.step) after.push(qeRowHTML(i, val));
  }
  const cnt = document.getElementById('qe-cnt');
  if (cnt) cnt.textContent = QE.saved ? `${QE.saved}건 기록함` : '';
  m.innerHTML = `${before.length ? `<div class="qe-stack">${before.join('')}</div>` : ''}
    <section class="qe-cur" id="qe-cur"></section>
    <p class="qe-err" id="qe-err"></p>
    ${after.length ? `<div class="qe-stack after">${after.join('')}</div>` : ''}`;
  m.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    d.step = Number(b.dataset.s); d.focus = d.step === 1; qePaint();
  }));
  const cur = m.querySelector('#qe-cur');
  el.dataset.step = d.step;
  dock.innerHTML = '';
  if (d.step === 1) qeStepMerch(cur, dock);
  else if (d.step === 2) qeStepCat(cur, dock);
  else if (d.step === 3) qeStepAmount(cur, dock);
  else qeStepDate(cur, dock);
  dock.hidden = !dock.innerHTML.trim();
  m.scrollTop = d.step === 1 ? m.scrollHeight : 0;
}

/* 사용처를 고르면 지난번 분류를 데려온다 — 분류가 정해지면 지출·수입·이체도 같이 정해진다 */
function qePickMerch(name) {
  const d = QE.d;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  d.merchant = name;
  d.noMerch = !name;
  const st = QE.stats[name];
  if (st && st.catId && qeCat(st.catId)) {
    const c = qeCat(st.catId);
    d.kind = c.kind; d.cat = c.category; d.catId = st.catId;
  }
  const mm = qeMerch(name);
  if (mm && mm.is_fixed) d.fixed = true;
  d.step = d.catId ? 3 : 2;
  qePaint();
}

/* 1) 사용처 — 채팅 앱처럼 입력칸은 맨 아래(키보드 바로 위), 후보는 그 위로 쌓인다.
   가장 그럴듯한 후보가 입력칸 바로 위에 불이 켜져 있고, 키보드의 '다음'을 누르면 그걸 고른다.
   목록에 없는 이름이면 '다음'이 곧 새로 쓰기. 엄지 하나로 끝난다. */
function qeStepMerch(cur, dock) {
  const d = QE.d;
  cur.innerHTML = `<div class="qe-list" id="qe-sugs"></div>`;
  dock.innerHTML = `<div class="qe-drow">
      <input class="qe-in" id="qe-merch" placeholder="어디에 썼나요?" autocomplete="off" autocorrect="off"
             autocapitalize="off" spellcheck="false" enterkeyhint="next" value="${qeEsc(d.merchant)}">
      <button class="qe-go" id="qe-mgo">다음</button>
    </div>`;
  qeSugs();
  const mi = dock.querySelector('#qe-merch');
  /* 한글은 여러 번의 input 으로 한 글자가 된다 — 입력칸은 그대로 두고 후보만 다시 그린다 */
  const sync = () => { d.merchant = mi.value; qeSugs(); };
  mi.addEventListener('input', sync);
  mi.addEventListener('compositionupdate', sync);
  mi.addEventListener('compositionend', sync);
  mi.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    d.merchant = mi.value;
    qePickBest();
  });
  const go = dock.querySelector('#qe-mgo');
  go.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); });
  go.addEventListener('click', () => { d.merchant = mi.value; qePickBest(); });
  /* 누른 손길 안에서 바로 커서를 줘야 아이폰 키보드가 올라온다 (setTimeout 이면 안 올라온다) */
  if (d.focus) { d.focus = false; mi.focus({ preventScroll: true }); }
}

/* 지금 입력에 가장 맞는 후보: 같은 이름 > 앞글자가 같은 것 > 들어 있는 것 (자주 쓴 순).
   아무것도 안 맞으면 '새로 쓰기', 아무것도 안 쳤으면 가장 자주 쓴 곳. */
function qeRank() {
  const q = QE.d.merchant.trim().toLowerCase();
  const all = Object.values(QE.stats);
  const byUse = (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko');
  if (!q) return { list: all.sort(byUse).slice(0, 6), best: all.length ? all.sort(byUse)[0].name : null, isNew: false, q };
  const exact = all.filter(x => x.name.toLowerCase() === q);
  const pre = all.filter(x => x.name.toLowerCase() !== q && x.name.toLowerCase().startsWith(q)).sort(byUse);
  const inc = all.filter(x => !x.name.toLowerCase().startsWith(q) && x.name.toLowerCase().includes(q)).sort(byUse);
  const list = [...exact, ...pre, ...inc].slice(0, 6);
  return { list, best: list.length ? list[0].name : null, isNew: !exact.length, q };
}
function qePickBest() {
  const typed = QE.d.merchant.trim();
  const r = qeRank();
  /* 친 글자가 후보의 일부일 때만 후보를 고른다 — 아니면 친 그대로 새 사용처 */
  if (r.best !== null && (!typed || r.list.length)) qePickMerch(r.best);
  else qePickMerch(typed);
}

function qeSugs() {
  const host = document.getElementById('qe-sugs');
  if (!host) return;
  const r = qeRank();
  const typed = QE.d.merchant.trim();
  const rows = r.list.map((x, i) => `<button data-m="${qeEsc(x.name)}" class="${i === 0 ? 'best' : ''}">
      <span class="nm">${qeEsc(x.name)}</span>
      ${x.catId ? `<span class="ct">${qeEsc(qeCatLabel(x.catId))}</span>` : ''}${i === 0 ? '<span class="kb">다음 ↵</span>' : ''}</button>`);
  if (typed && r.isNew) rows.push(`<button data-m="${qeEsc(typed)}" class="new${r.list.length ? '' : ' best'}"><span class="nm">'${qeEsc(typed)}' 새로 쓰기</span>${r.list.length ? '' : '<span class="kb">다음 ↵</span>'}</button>`);
  rows.push(`<button data-m="" class="mut"><span class="nm">사용처 없이 넘어가기</span></button>`);
  /* 아래(입력칸 쪽)부터 가까운 순 — 첫 후보가 입력칸 바로 위에 온다 */
  host.innerHTML = `${!QE.loaded ? '<div class="qe-hint">사용처 불러오는 중…</div>' : !typed && !r.list.length ? '<div class="qe-hint">사용처를 입력하세요</div>' : ''}`
    + rows.reverse().join('');
  /* 누르는 순간 키보드가 먼저 내려가며 화면이 움직여 엉뚱한 줄이 눌리지 않게, 손을 대는 순간 고른다 */
  host.querySelectorAll('[data-m]').forEach(b => {
    b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { e.preventDefault(); b.dataset.hit = '1'; } });
    b.addEventListener('pointerup', (e) => { if (b.dataset.hit) { e.preventDefault(); delete b.dataset.hit; qePickMerch(b.dataset.m); } });
    b.addEventListener('pointercancel', () => { delete b.dataset.hit; });
    b.addEventListener('click', () => { if (QE.d && QE.d.step === 1) qePickMerch(b.dataset.m); });
  });
  const m = host.closest('.qe-main');
  if (m) m.scrollTop = m.scrollHeight;
}

/* 2) 분류 — 누르기만 하므로 키보드 없음 */
function qeStepCat(cur) {
  const d = QE.d;
  const c0 = d.catId ? qeCat(d.catId) : null;
  const groups = [...new Set(QE.cats.map(c => c.category))];
  const openGroup = d.cat || (c0 ? c0.category : groups[0]);
  const subs = QE.cats.filter(c => c.category === openGroup);
  cur.innerHTML = `<div class="qe-lab">분류</div>
    <div class="qe-chips">${groups.map(g =>
      `<button data-g="${qeEsc(g)}" class="${g === openGroup ? 'on' : ''}">${qeEsc(g)}</button>`).join('')}</div>
    <div class="qe-lab sm">${qeEsc(openGroup || '')}</div>
    <div class="qe-grid">${subs.map(c =>
      `<button data-c="${c.id}" class="${d.catId === c.id ? 'on' : ''}">${qeEsc(c.subcategory)}</button>`).join('')}</div>`;
  cur.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { d.cat = b.dataset.g; qePaint(); }));
  cur.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
    d.catId = Number(b.dataset.c);
    const c = qeCat(d.catId);
    if (c) { d.kind = c.kind; d.cat = c.category; }
    d.step = 3; qePaint();
  }));
}

function qeOften() {
  const st = QE.stats[QE.d.merchant.trim()];
  if (!st || !st.amounts.length) return [];
  const cnt = {};
  st.amounts.forEach(a => { cnt[a] = (cnt[a] || 0) + 1; });
  return Object.entries(cnt).sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, 4).map(x => Number(x[0]));
}

/* 3) 금액 — 휴대폰 키보드 대신 화면 키패드 (화면이 밀리지 않는다) */
function qeStepAmount(cur, dock) {
  const d = QE.d;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const often = qeOften();
  cur.innerHTML = `<div class="qe-lab">금액</div>
    <div class="qe-amt mono${d.amount ? '' : ' ph'}">${d.amount ? qeComma(d.neg ? -Number(d.amount) : Number(d.amount)) : '0'}<small>원</small></div>
    <div class="qe-chips row">
      <button data-neg="1" class="${d.neg ? 'on' : 'mut'}">− 환불</button>
      ${often.map(a => `<button data-a="${a}" class="num">${qeComma(a)}</button>`).join('')}
    </div>`;
  dock.innerHTML = `<div class="qe-pad" id="qe-pad">
      ${keys.map(k => `<button data-k="${k}">${k}</button>`).join('')}
      <button class="fn" data-k="00">00</button><button data-k="0">0</button><button class="fn" data-k="del" aria-label="지우기">⌫</button>
    </div>
    <button class="qe-save" id="qe-next" ${d.amount ? '' : 'disabled'}>다음</button>`;
  dock.querySelector('#qe-pad').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    let v = d.amount;
    if (k === 'del') v = v.slice(0, -1);
    else if (v.length < 11) v = (v === '' && k === '00') ? '' : v + k;
    d.amount = v.replace(/^0+(?=\d)/, '');
    /* 숫자 한 번에 화면 전체를 다시 그리지 않고 금액만 바꾼다 */
    const amt = cur.querySelector('.qe-amt');
    amt.classList.toggle('ph', !d.amount);
    amt.innerHTML = `${d.amount ? qeComma(d.neg ? -Number(d.amount) : Number(d.amount)) : '0'}<small>원</small>`;
    dock.querySelector('#qe-next').disabled = !d.amount;
  });
  cur.querySelectorAll('[data-neg]').forEach(b => b.addEventListener('click', () => { d.neg = !d.neg; qePaint(); }));
  cur.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { d.amount = b.dataset.a; d.step = 4; qePaint(); }));
  dock.querySelector('#qe-next').addEventListener('click', () => { if (d.amount) { d.step = 4; qePaint(); } });
}

/* 4) 날짜·표시·메모 — 메모칸은 위쪽, 기록하기는 아래. 키보드가 올라오면 기록하기가 키보드 바로 위에 붙는다 */
function qeStepDate(cur, dock) {
  const d = QE.d;
  const days = [[0, '오늘'], [-1, '어제'], [-2, '그저께']];
  const custom = !days.some(([n]) => d.date === qeDay(n));
  cur.innerHTML = `<div class="qe-lab">날짜</div>
    <div class="qe-chips">
      ${days.map(([n, l]) => `<button data-d="${n}" class="${d.date === qeDay(n) ? 'on' : ''}">${l}</button>`).join('')}
      <label class="qe-datepick${custom ? ' on' : ''}"><span>${custom ? qeEsc(qeDateLabel(d.date)) : '다른 날'}</span>
        <input type="date" id="qe-date" value="${d.date}" max="${qeDay(0)}"></label>
    </div>
    <div class="qe-lab">표시 <i>선택</i></div>
    <div class="qe-chips">
      <button data-t="fixed" class="${d.fixed ? 'on' : 'mut'}">고정비</button>
      <button data-t="co" class="${d.co ? 'on' : 'mut'}">회사 환급</button>
      <button data-t="good" class="${d.good === 'Good' ? 'on' : 'mut'}">좋은 지출</button>
      <button data-t="bad" class="${d.good === 'Bad' ? 'on' : 'mut'}">아쉬운 지출</button>
    </div>
    <input class="qe-in qe-memo" id="qe-note" placeholder="메모 (선택)" value="${qeEsc(d.note)}"
           autocomplete="off" enterkeyhint="done">`;
  dock.innerHTML = `<button class="qe-save" id="qe-save">기록하기</button>`;
  cur.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { d.date = qeDay(Number(b.dataset.d)); qeRepaintKeepNote(); }));
  const dp = cur.querySelector('#qe-date');
  dp.addEventListener('change', () => { if (dp.value) { d.date = dp.value; qeRepaintKeepNote(); } });
  cur.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'fixed') d.fixed = !d.fixed;
    else if (t === 'co') d.co = !d.co;
    else if (t === 'good') d.good = d.good === 'Good' ? null : 'Good';
    else if (t === 'bad') d.good = d.good === 'Bad' ? null : 'Bad';
    b.className = (t === 'fixed' ? d.fixed : t === 'co' ? d.co : t === 'good' ? d.good === 'Good' : d.good === 'Bad') ? 'on' : 'mut';
    if (t === 'good' || t === 'bad') cur.querySelectorAll('[data-t=good],[data-t=bad]').forEach(x => {
      x.className = d.good === (x.dataset.t === 'good' ? 'Good' : 'Bad') ? 'on' : 'mut';
    });
  }));
  const nt = cur.querySelector('#qe-note');
  nt.addEventListener('input', (e) => { d.note = e.target.value; });
  nt.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault(); nt.blur();
  });
  /* 메모에 커서가 있어도 기록하기를 누르는 순간 키보드가 내려가며 버튼이 밀리지 않게 */
  const sv = dock.querySelector('#qe-save');
  sv.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); });
  sv.addEventListener('click', qeSave);
}
function qeRepaintKeepNote() {
  const nt = document.getElementById('qe-note');
  if (nt) QE.d.note = nt.value;
  qePaint();
}

async function qeSave() {
  const d = QE.d;
  const n = Number(d.amount || 0);
  const err = document.getElementById('qe-err');
  if (!n) { d.step = 3; qePaint(); document.getElementById('qe-err').textContent = '금액을 넣으세요.'; return; }
  if (!d.catId) { d.step = 2; qePaint(); document.getElementById('qe-err').textContent = '분류를 고르세요.'; return; }
  err.textContent = '';
  const ntEl = document.getElementById('qe-note');
  if (ntEl) { d.note = ntEl.value; ntEl.blur(); }
  const btn = document.getElementById('qe-save');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const c = await haedalSupabase();
    const nm = d.merchant.trim();
    const g = qeMerch(nm);
    const { error } = await c.from('transactions').insert({
      date: d.date, category_id: d.catId, amount: d.neg ? -n : n,
      merchant: nm || null, merchant_group: g ? g.merchant_group : null,
      note: d.note.trim() || null, good_bad: d.good, company_paid: d.co, is_fixed: d.fixed
    });
    if (error) throw new Error(error.message);
    if (nm) {
      const o = QE.stats[nm] || (QE.stats[nm] = { name: nm, count: 0, catCnt: {}, catId: null, amounts: [] });
      o.count++; o.catCnt[d.catId] = (o.catCnt[d.catId] || 0) + 1; o.catId = d.catId; o.amounts.unshift(n);
    }
    QE.saved++;
    enToast(qeComma(n) + '원 기록했습니다');
    if (typeof lgTouched === 'function') lgTouched();
    if (typeof enLoadLedger === 'function') enLoadLedger();
    const keep = d.date;
    QE.d = qeFresh();
    QE.d.date = keep;
    /* 저장은 서버를 기다린 뒤라 아이폰이 키보드를 안 올려 준다 — 커서 없이 두고, 입력칸을 누르면 올라온다 */
    QE.d.focus = false;
    qePaint();
  } catch (e) {
    err.textContent = '저장하지 못했습니다 — ' + (e.message || e);
    btn.disabled = false; btn.textContent = '기록하기';
  }
}
