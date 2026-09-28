/* ================= 빠른 기록 (폰) =================
   예전 폰 전용 앱(gagyebu.html)의 입력 방식을 본 사이트로 옮겼다.
   한 번에 한 칸씩 — 사용처 → 분류 → 금액 → 날짜 — 을 묻고, 손은 아래 도크에서만 움직인다.
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
    merchant: '', noMerch: false, note: '', noteOpen: false, date: qeDay(0),
    good: null, fixed: false, co: false, focusMerch: true };
}
/* 폰(좁은 화면)에서만 이 화면을 쓴다. PC 는 기존 기록 창 */
function qeWanted() { return window.matchMedia('(max-width: 640px)').matches; }

const qeCat = (id) => QE.cats.find(x => x.id === id) || QE.allCats.find(x => x.id === id);
const qeCatLabel = (id) => { const c = qeCat(id); return c ? `${c.category} › ${c.subcategory}` : '분류 없음'; };
const qeMerch = (name) => QE.merchants.find(x => x.name === name);

async function qeLoad() {
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

/* 키보드가 올라와도 아래 도크가 키보드 바로 위에 붙어 있게 실제 보이는 높이를 잡는다 */
function qeFitViewport() {
  const el = document.getElementById('qe');
  const vv = window.visualViewport;
  if (!el || el.hidden || !vv) return;
  el.style.height = vv.height + 'px';
  el.style.top = vv.offsetTop + 'px';
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', qeFitViewport);
  window.visualViewport.addEventListener('scroll', qeFitViewport);
}

async function qeOpen() {
  const el = qeRoot();
  QE.open = true;
  QE.saved = 0;
  el.hidden = false;
  document.body.classList.add('qe-on');
  el.innerHTML = `<div class="qe-top"><b>기록</b><span class="sp"></span><button class="qe-x" id="qe-x" aria-label="닫기">닫기</button></div>
    <div class="qe-main"><div class="qe-empty">불러오는 중…</div></div><div class="qe-dock"></div>`;
  el.querySelector('#qe-x').addEventListener('click', qeClose);
  qeFitViewport();
  try {
    if (!QE.loaded) await qeLoad();
  } catch (e) {
    el.querySelector('.qe-main').innerHTML = `<div class="qe-empty">불러오지 못했어요 — ${qeEsc(e.message || e)}</div>`;
    return;
  }
  QE.d = qeFresh();
  qePaint();
}

function qeClose() {
  const el = document.getElementById('qe');
  if (el) { el.hidden = true; el.innerHTML = ''; el.style.height = ''; el.style.top = ''; }
  document.body.classList.remove('qe-on');
  QE.open = false;
  /* 새로 넣은 기록이 홈·내역 숫자에 바로 반영되게 다시 읽는다 */
  if (QE.saved && typeof fetchLive === 'function') fetchLive(false, Promise.resolve());
}

function qePaint() {
  const el = document.getElementById('qe');
  if (!el || el.hidden) return;
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
  const tags = [d.neg ? '환불' : '', d.fixed ? '고정비' : '', d.co ? '회사' : '',
    d.good === 'Good' ? '좋은 지출' : d.good === 'Bad' ? '아쉬운 지출' : '', d.note.trim()].filter(Boolean);
  m.innerHTML = `<div class="qe-stack">
    ${QE_STEPS.map((k, i) => {
      const n = i + 1;
      if (n > d.reach) return '';
      const filled = !!val[i];
      return `<button class="qe-row${n === d.step ? ' cur' : ''}" data-s="${n}">
        <span class="k">${k}</span>
        <span class="v${i >= 2 ? ' num' : ''}${filled ? '' : ' ph'}">${qeEsc(filled ? val[i] : '…')}</span>
      </button>`;
    }).join('')}
    ${d.reach === 4 && tags.length ? `<button class="qe-row" data-s="4"><span class="k">표시</span>
      <span class="v">${qeEsc(tags.join(' · '))}</span></button>` : ''}
  </div>
  <p class="qe-err" id="qe-err"></p>
  ${QE.saved ? `<p class="qe-note">이번에 ${QE.saved}건 기록했어요. 다 넣었으면 닫기.</p>` : ''}`;
  m.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    d.step = Number(b.dataset.s); d.focusMerch = d.step === 1; qePaint();
  }));
  if (d.step === 1) qeDockMerch(dock);
  else if (d.step === 2) qeDockCat(dock);
  else if (d.step === 3) qeDockAmount(dock);
  else qeDockDate(dock);
}

/* 사용처를 고르면 지난번 분류를 데려온다 — 분류가 정해지면 지출·수입·이체도 같이 정해진다 */
function qePickMerch(name) {
  const d = QE.d;
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

function qeDockMerch(dock) {
  const d = QE.d;
  dock.innerHTML = `<div class="qe-sugs v" id="qe-sugs"></div>
    <div class="qe-drow">
      <input class="qe-in" id="qe-merch" placeholder="사용처" autocomplete="off" autocapitalize="off"
             enterkeyhint="next" value="${qeEsc(d.merchant)}">
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
    qePickMerch(mi.value.trim());
  });
  dock.querySelector('#qe-mgo').addEventListener('click', () => qePickMerch(mi.value.trim()));
  if (d.focusMerch) { d.focusMerch = false; setTimeout(() => mi.focus(), 30); }
}

function qeSugs() {
  const host = document.getElementById('qe-sugs');
  if (!host) return;
  const q = QE.d.merchant.trim().toLowerCase();
  let list = Object.values(QE.stats);
  if (q) list = list.filter(x => x.name.toLowerCase().includes(q));
  list = list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')).slice(0, 5);
  const exact = q && list.some(x => x.name.toLowerCase() === q);
  host.innerHTML = list.map(x => `<button data-m="${qeEsc(x.name)}"><span class="nm">${qeEsc(x.name)}</span>
      ${x.catId ? `<span class="ct">${qeEsc(qeCatLabel(x.catId))}</span>` : ''}</button>`).join('')
    + (q && !exact ? `<button data-m="${qeEsc(QE.d.merchant.trim())}"><span class="nm">'${qeEsc(QE.d.merchant.trim())}' 새로</span></button>` : '')
    + `<button data-m="" class="mut"><span class="nm">사용처 없이</span></button>`;
  host.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => qePickMerch(b.dataset.m)));
}

function qeDockCat(dock) {
  const d = QE.d;
  const cur = d.catId ? qeCat(d.catId) : null;
  const groups = [...new Set(QE.cats.map(c => c.category))];
  const openGroup = d.cat || (cur ? cur.category : groups[0]);
  const subs = QE.cats.filter(c => c.category === openGroup);
  dock.innerHTML = `<div class="qe-sugs">${groups.map(g =>
      `<button data-g="${qeEsc(g)}" class="${g === openGroup ? 'on' : ''}">${qeEsc(g)}</button>`).join('')}</div>
    <div class="qe-sugs">${subs.map(c =>
      `<button data-c="${c.id}" class="${d.catId === c.id ? 'on' : ''}">${qeEsc(c.subcategory)}</button>`).join('')}</div>`;
  dock.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { d.cat = b.dataset.g; qePaint(); }));
  dock.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
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

function qeDockAmount(dock) {
  const d = QE.d;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  dock.innerHTML = `<div class="qe-sugs">
      <button data-neg="1" class="${d.neg ? 'on' : 'mut'}">− 마이너스</button>
      ${qeOften().map(a => `<button data-a="${a}">${qeComma(a)}</button>`).join('')}
    </div>
    <div class="qe-pad" id="qe-pad">
      ${keys.map(k => `<button data-k="${k}">${k}</button>`).join('')}
      <button class="fn" data-k="00">00</button><button data-k="0">0</button><button class="fn" data-k="del">⌫</button>
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
    qePaint();
  });
  dock.querySelectorAll('[data-neg]').forEach(b => b.addEventListener('click', () => { d.neg = !d.neg; qePaint(); }));
  dock.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { d.amount = b.dataset.a; d.step = 4; qePaint(); }));
  dock.querySelector('#qe-next').addEventListener('click', () => { if (d.amount) { d.step = 4; qePaint(); } });
}

function qeDockDate(dock) {
  const d = QE.d;
  const days = [[0, '오늘'], [-1, '어제'], [-2, '그저께']];
  dock.innerHTML = `<div class="qe-sugs">
      ${days.map(([n, l]) => `<button data-d="${n}" class="${d.date === qeDay(n) ? 'on' : ''}">${l}</button>`).join('')}
      <button data-t="neg" class="${d.neg ? 'on' : 'mut'}">환불</button>
      <button data-t="fixed" class="${d.fixed ? 'on' : 'mut'}">고정비</button>
      <button data-t="co" class="${d.co ? 'on' : 'mut'}">회사</button>
      <button data-t="good" class="${d.good === 'Good' ? 'on' : 'mut'}">좋은</button>
      <button data-t="bad" class="${d.good === 'Bad' ? 'on' : 'mut'}">아쉬운</button>
      <button data-t="note" class="${d.noteOpen || d.note ? 'on' : 'mut'}">메모</button>
    </div>
    ${d.noteOpen ? `<input class="qe-in" id="qe-note" placeholder="메모" value="${qeEsc(d.note)}" style="margin-bottom:8px;">` : ''}
    <button class="qe-save" id="qe-save">기록하기</button>`;
  dock.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { d.date = qeDay(Number(b.dataset.d)); qePaint(); }));
  dock.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'neg') d.neg = !d.neg;
    else if (t === 'fixed') d.fixed = !d.fixed;
    else if (t === 'co') d.co = !d.co;
    else if (t === 'good') d.good = d.good === 'Good' ? null : 'Good';
    else if (t === 'bad') d.good = d.good === 'Bad' ? null : 'Bad';
    else if (t === 'note') d.noteOpen = !d.noteOpen;
    qePaint();
  }));
  const nt = dock.querySelector('#qe-note');
  if (nt) { nt.addEventListener('input', (e) => { d.note = e.target.value; }); nt.focus(); }
  dock.querySelector('#qe-save').addEventListener('click', qeSave);
}

async function qeSave() {
  const d = QE.d;
  const n = Number(d.amount || 0);
  const err = document.getElementById('qe-err');
  if (!n) { d.step = 3; qePaint(); document.getElementById('qe-err').textContent = '금액을 넣으세요.'; return; }
  if (!d.catId) { d.step = 2; qePaint(); document.getElementById('qe-err').textContent = '분류를 고르세요.'; return; }
  err.textContent = '';
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
    qePaint();
  } catch (e) {
    err.textContent = '저장하지 못했습니다 — ' + (e.message || e);
    btn.disabled = false; btn.textContent = '기록하기';
  }
}
