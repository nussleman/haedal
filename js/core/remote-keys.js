/* ---------------- 즐겨찾기 리모컨 ----------------
   어느 화면에 있든 자주 가는 메뉴로 한 번에 건너뛴다. F(ㄹ) 로 열고 숫자로 고른다.
   메뉴를 늘리려면 아래 한 줄만 더하면 된다 — [섹션, 하위탭, 이름, 아이콘]. */
const RC_ITEMS = [
  ['home',   'main',    '홈',          '🏠'],
  ['report', 'monthly', '월간 리포트', '📅'],
  ['entry',  'ledger',  '입출금 내역', '📒']
];

function rcIsOpen() {
  const p = document.getElementById('rc-panel');
  return !!p && !p.hidden;
}

function rcToggle(force) {
  const p = document.getElementById('rc-panel');
  if (!p) return;
  const next = (force === undefined) ? p.hidden : !!force;
  p.hidden = !next;
  const b = document.getElementById('rc-btn');
  if (b) { b.classList.toggle('on', next); b.setAttribute('aria-expanded', String(next)); }
  if (next) { const f = p.querySelector('.rc-item'); if (f) f.focus(); }
}

function rcGo(sec, sub) {
  rcToggle(false);
  const ov = document.getElementById('en-ov');
  if (ov && !ov.hidden) enClose();
  goTo(sec, sub);
}

function rcInit() {
  if (document.getElementById('rc-dock')) return;
  const dock = document.createElement('div');
  dock.id = 'rc-dock';
  dock.innerHTML = `
    <div class="rc-panel" id="rc-panel" hidden>
      <div class="rc-hd"><span>즐겨찾기</span><kbd>F</kbd></div>
      ${RC_ITEMS.map(([sec, sb, label, icon], i) => `
        <button class="rc-item" data-sec="${sec}" data-sub="${sb}">
          <span class="ic">${icon}</span><span class="tx">${label}</span><kbd>${i + 1}</kbd>
        </button>`).join('')}
      <div class="rc-ft"><kbd>N</kbd>기록<kbd>Esc</kbd>닫기</div>
    </div>
    <button class="rc-btn" id="rc-btn" title="즐겨찾기 리모컨 (F)" aria-expanded="false">
      <span class="d">🎛</span><span class="l">리모컨</span><kbd>F</kbd>
    </button>`;
  document.body.appendChild(dock);
  document.getElementById('rc-btn').addEventListener('click', () => rcToggle());
  dock.addEventListener('click', (e) => {
    const b = e.target.closest('.rc-item');
    if (b) rcGo(b.dataset.sec, b.dataset.sub);
  });
  /* 딴 데를 누르면 닫힌다 — 리모컨이 화면을 가리고 서 있지 않게 */
  document.addEventListener('mousedown', (e) => {
    if (!rcIsOpen()) return;
    if (e.target.closest && e.target.closest('#rc-dock')) return;
    rcToggle(false);
  });
}

/* ---------------- 단축키 ---------------- */
document.addEventListener('keydown', (e) => {
  const ov = document.getElementById('en-ov');
  const open = ov && !ov.hidden;
  if (e.key === 'Escape' && open) { enClose(); return; }
  if (e.key === 'Escape' && rcIsOpen()) { rcToggle(false); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  /* 키를 누르고 있어서 생기는 반복은 단축키로 치지 않는다 — 창이 깜빡이며 열고 닫히던 것 */
  if (e.repeat) return;
  /* 표에서 글자를 쳐서 칸 고치기가 열린 경우처럼, 이미 누가 가져간 키는 단축키로 쓰지 않는다 */
  if (e.defaultPrevented) return;
  /* 리모컨이 열려 있으면 숫자로 바로 간다 */
  if (rcIsOpen() && /^[1-9]$/.test(e.key)) {
    const it = RC_ITEMS[Number(e.key) - 1];
    if (it) { e.preventDefault(); rcGo(it[0], it[1]); return; }
  }
  if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') { e.preventDefault(); rcToggle(); }
  else if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') { e.preventDefault(); rcToggle(false); open ? enClose() : enOpen(); }
  else if (e.key === 'l' || e.key === 'L' || e.key === 'ㅣ') { e.preventDefault(); rcToggle(false); if (open) enClose(); goTo('entry', 'ledger'); }
  else if (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') { e.preventDefault(); rcToggle(false); if (open) enClose(); dbmOpen(); }
});

/* 가계부를 고쳤으면 캐시된 원장도 같이 갱신한다 — 탭을 옮겼을 때 옛 숫자가 남지 않게 */
let lgRefreshTimer = null;
function lgTouched() {
  clearTimeout(lgRefreshTimer);
  lgRefreshTimer = setTimeout(async () => {
    try {
      const fresh = await fetchLedgerFromDB();
      if (!fresh || !fresh.length || !state.data) return;
      state.data.ledger = fresh;
      state.data.ledgerSource = 'db';
      const pv = buildPivotFromLedger(fresh);
      if (pv) {
        state.data.months = pv.months;
        state.data.incomeTotal = pv.incomeTotal;
        state.data.expenseTotal = pv.expenseTotal;
        state.data.expenseCategories = pv.expenseCategories;
        state.data.incomeCategories = pv.incomeCategories;
        state.data.transferCategories = pv.transferCategories;
      }
      /* 흐름(오늘·이번달·올해) 화면은 원장을 그대로 그리므로, 고친 값이 바로 보이게 다시 그린다.
         전체 내역·자산 화면은 각자 다시 읽으므로 여기서 건드리지 않는다. */
      if (state.page === 'entry' && !document.querySelector('.lg-ed')) renderPage();
      /* 전체 내역도 열려 있으면 같이 맞춘다 — 단, 그 안에서 뭔가 입력 중이면 건드리지 않는다 */
      const lgList = document.getElementById('lg-list');
      if (lgList && !lgList.contains(document.activeElement)) enLoadLedger();
    } catch (e) { /* 다음 새로고침에서 다시 맞춰진다 */ }
  }, 900);
}

function renderAll() {
  renderBanner();
  setSyncState(state.source === 'live' ? (state.lastError ? 'err' : 'live') : state.lastError ? 'err' : 'loading');
  renderPage();
}
