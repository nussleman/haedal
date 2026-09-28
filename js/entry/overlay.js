/* ---------------- 오버레이 ---------------- */
function enOverlay() {
  let ov = document.getElementById('en-ov');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'en-ov';
  ov.hidden = true;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', '가계부 기록');
  ov.addEventListener('click', e => { if (e.target === ov) enClose(); });
  document.body.appendChild(ov);
  return ov;
}
function enClose() {
  const ov = document.getElementById('en-ov');
  if (ov) ov.hidden = true;
  document.body.style.overflow = '';
  const b = document.getElementById('entry-btn');
  if (b) b.focus();
}
async function enOpen() {
  const ov = enOverlay();
  ov.hidden = false;
  document.body.style.overflow = 'hidden';
  ov.innerHTML = '<div class="en-modal"><div class="en-empty">불러오는 중…</div></div>';
  await enEnsureRefs();
  enRenderEntry();
}

function enRenderEntry() {
  const ov = document.getElementById('en-ov');
  ov.innerHTML = `
    <div class="en-modal">
      <div class="en-head">
        <h3>가계부 기록</h3>
        <button class="en-x" id="en-close" aria-label="닫기">×</button>
      </div>
      <div class="en-two">
        <div>
          <div class="en-fld">
            <label class="en-lab" for="en-merch">사용처</label>
            <input class="en-in" id="en-merch" autocomplete="off" placeholder="예: 매머드커피"
                   role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="en-ac">
            <div class="en-ac" id="en-ac" role="listbox" hidden></div>
          </div>

          <div class="en-fld">
            <label class="en-lab" for="en-amt">금액</label>
            <div class="en-money">
              <span class="en-kind-badge none" id="en-kind">분류 미선택</span>
              <input class="en-amt" id="en-amt" inputmode="numeric" placeholder="0" autocomplete="off">
              <span class="en-won">원</span>
            </div>
          </div>

          <div class="en-fld">
            <div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 5px;">
              <span class="en-lab" style="margin:0;">분류</span>
              <button class="btn small" id="en-more">전체 보기</button>
            </div>
            <input class="en-catsearch" id="en-catq" placeholder="분류 검색 — 예: 카페, 택시" autocomplete="off">
            <div class="en-chips" id="en-top"></div>
            <div class="en-more" id="en-morebox"></div>
          </div>

          <div class="en-fld">
            <label class="en-lab" for="en-date">날짜</label>
            <input class="en-in" id="en-date" type="date" value="${enToday()}" style="color-scheme:dark;">
          </div>
          <div class="en-fld">
            <label class="en-lab" for="en-note">메모 <span style="color:var(--text-faint);">— 선택</span></label>
            <input class="en-in" id="en-note" autocomplete="off">
          </div>

          <div class="en-tgs">
            <button class="en-tg" id="en-co" aria-pressed="false">🏢 회사비</button>
            <button class="en-tg" id="en-fx" aria-pressed="false">📌 고정비</button>
            <button class="en-tg en-tg-good" id="en-good" aria-pressed="false">👍 Good</button>
            <button class="en-tg en-tg-bad" id="en-bad" aria-pressed="false">👎 Bad</button>
          </div>

          <p class="en-err" id="en-serr"></p>
          <button class="en-cta" id="en-save">기록하기 <kbd class="en-kbd">Ctrl</kbd><kbd class="en-kbd">Enter</kbd></button>
        </div>

        <div class="en-side">
          <span class="en-lab">방금 기록한 것</span>
          <p class="en-sub">최근 날짜순 8건</p>
          <div id="en-recent"><div class="en-empty">불러오는 중…</div></div>
        </div>
      </div>
    </div>`;

  enQS('#en-close').addEventListener('click', enClose);
  enQS('#en-more').addEventListener('click', () => {
    const box = enQS('#en-morebox');
    const open = box.classList.toggle('open');
    enQS('#en-more').textContent = open ? '접기' : '전체 보기';
    if (open && !box.dataset.built) { enBuildAllChips(); box.dataset.built = '1'; }
  });

  enSetupMerchant();
  enSetupCatSearch();

  /* 금액 : 키보드 − 허용 */
  const amt = enQS('#en-amt');
  amt.addEventListener('input', () => {
    const t = amt.value;
    const minus = /^\s*[-−]/.test(t);
    const raw = t.replace(/[^\d]/g, '');
    if (minus !== EN.neg) { EN.neg = minus; amt.classList.toggle('neg', EN.neg); }
    amt.value = raw ? (EN.neg ? '−' : '') + enComma(raw) : (EN.neg ? '−' : '');
  });
  amt.addEventListener('keydown', e => {
    /* 키를 살짝 길게 눌러 생기는 반복 입력(e.repeat)과,
       한글 조합 중 확정 엔터(isComposing / keyCode 229)는 저장으로 치지 않는다. */
    if (e.key !== 'Enter' || e.repeat || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    enSave();
  });

  ['#en-co', '#en-fx'].forEach(sel => enQS(sel).addEventListener('click', () => {
    const el = enQS(sel);
    el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  }));
  const pair = (x, y) => enQS(x).addEventListener('click', () => {
    const on = enQS(x).getAttribute('aria-pressed') === 'true';
    enQS(x).setAttribute('aria-pressed', String(!on));
    enQS(y).setAttribute('aria-pressed', 'false');
  });
  pair('#en-good', '#en-bad'); pair('#en-bad', '#en-good');

  enQS('#en-save').addEventListener('click', enSave);
  enQS('.en-modal').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.repeat && !e.isComposing) {
      e.preventDefault(); enSave();
    }
  });
  enBuildTopChips();
  enSyncCat();
  enLoadRecent();
  enQS('#en-merch').focus();
}

/* 사용처 자동완성 : 분류까지 함께 보여준다.
   기록 창과 목록 화면이 같은 사용처 사전을 쓴다. */
function enAttachMerchantAC(inp, box, opt) {
  const o = opt || {};
  let list = [], cur = -1;

  const close = () => { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); cur = -1; };
  const pick = (name) => {
    const gp = (EN.merchGroup && EN.merchGroup[name]) || '';
    inp.value = o.withGroup ? ((gp ? gp + ' › ' : '') + name) : name;
    close();
    if (o.onPick) o.onPick(name);
  };
  const paint = () => {
    box.querySelectorAll('.en-ac-item').forEach((el, k) => el.classList.toggle('on', k === cur));
  };
  const open = () => {
    const rawv = inp.value.trim();
    const q = (rawv.includes('›') ? rawv.split('›').slice(1).join('›') : rawv).trim().toLowerCase();
    const pool = EN.merchants;
    const gOf = (m) => (EN.merchGroup && EN.merchGroup[m]) || '';
    list = (q ? pool.filter(m => m.toLowerCase().includes(q) || gOf(m).toLowerCase().includes(q)) : pool).slice(0, 40);
    if (!list.length) { close(); return; }
    box.innerHTML = list.map((m, k) => {
      const c = EN.catById[EN.merchCat[m]];
      const gp = gOf(m);
      let nm = enEsc(m);
      if (q) {
        const at = m.toLowerCase().indexOf(q);
        if (at >= 0) nm = enEsc(m.slice(0, at)) + '<mark>' + enEsc(m.slice(at, at + q.length)) + '</mark>' + enEsc(m.slice(at + q.length));
      }
      return `<div class="en-ac-item" role="option" data-k="${k}" aria-selected="false">
        ${gp ? `<span class="gp">${enEsc(gp)}</span>` : ''}
        <span class="nm">${nm}</span>
        <span class="ct">${c ? enEsc(c.category) + ' › ' + enEsc(c.subcategory) : '분류 없음'}</span>
      </div>`;
    }).join('');
    box.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    cur = -1;
    box.querySelectorAll('.en-ac-item').forEach(el =>
      el.addEventListener('mousedown', e => { e.preventDefault(); pick(list[Number(el.dataset.k)]); }));
  };

  inp.addEventListener('mousedown', () => setTimeout(open, 0));
  inp.addEventListener('input', open);
  inp.addEventListener('blur', () => setTimeout(close, 120));
  inp.addEventListener('keydown', e => {
    if (box.hidden) {
      if (e.key === 'Enter') { e.preventDefault(); if (o.onNext) o.onNext(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, list.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0) pick(list[cur]);
      else { close(); if (o.onNext) o.onNext(); }
    } else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}

function enSetupMerchant() {
  enAttachMerchantAC(enQS('#en-merch'), enQS('#en-ac'), {
    withGroup: true,
    onNext: () => enQS('#en-amt').focus(),
    onPick: (name) => {
      const cid = EN.merchCat[name];
      if (cid) { EN.catId = cid; enSyncCat(); }
      const fx = enQS('#en-fx');
      if (fx && enMerchFixed(name)) fx.setAttribute('aria-pressed', 'true');
      enQS('#en-amt').focus();
    }
  });
}

/* 분류 검색 */
function enSetupCatSearch() {
  const q = enQS('#en-catq');
  if (!q) return;
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    const box = enQS('#en-top');
    if (!t) { enBuildTopChips(); return; }
    const hit = EN.cats.filter(c =>
      (c.subcategory + ' ' + c.category + ' ' + c.kind).toLowerCase().includes(t)).slice(0, 8);
    box.innerHTML = hit.length ? hit.map(enChipHTML).join('')
      : '<div class="en-empty" style="grid-column:1/-1;">일치하는 분류가 없습니다.</div>';
    enBindChips(box);
  });
}

function enChipHTML(c) {
  return `<button class="en-chip" data-id="${c.id}" aria-pressed="${EN.catId === c.id}">
    <span class="k ${c.kind}" aria-hidden="true"></span>
    <span class="e" aria-hidden="true">${c.emoji_category || ''}</span>
    <span class="t">${enEsc(c.subcategory)}</span></button>`;
}
function enBindChips(scope) {
  scope.querySelectorAll('.en-chip').forEach(el => {
    el.addEventListener('click', () => {
      EN.catId = Number(el.dataset.id);
      enSyncCat();
      enQS('#en-serr').textContent = '';
      if (!enQS('#en-amt').value) enQS('#en-amt').focus();
    });
  });
}
function enBuildTopChips() {
  const top = [...EN.cats].sort((a, b) => (EN.freq[b.id] || 0) - (EN.freq[a.id] || 0)).slice(0, 8);
  const box = enQS('#en-top');
  box.innerHTML = top.map(enChipHTML).join('');
  enBindChips(box);
}
function enBuildAllChips() {
  const box = enQS('#en-morebox');
  box.innerHTML = ['지출', '수입', '이체'].map(k => {
    const list = EN.cats.filter(c => c.kind === k);
    if (!list.length) return '';
    return `<div class="en-grouplab">${k}</div><div class="en-chips">${list.map(enChipHTML).join('')}</div>`;
  }).join('');
  enBindChips(box);
}
function enSyncCat() {
  document.querySelectorAll('.en-chip').forEach(x =>
    x.setAttribute('aria-pressed', String(Number(x.dataset.id) === EN.catId)));
  const badge = enQS('#en-kind');
  if (!badge) return;
  const c = EN.catById[EN.catId];
  badge.className = 'en-kind-badge ' + (c ? c.kind : 'none');
  badge.textContent = c ? c.kind + ' · ' + c.subcategory : '분류 미선택';
}

/* 한 번 눌렀는데 두 건이 들어가던 것 막기.
   버튼 disabled 만으로는 못 막는다 — 엔터·Ctrl+Enter 는 버튼을 거치지 않고
   바로 enSave 를 부르기 때문에, 저장이 끝나기 전에 또 불리면 그대로 두 번 들어간다.
   저장 중인지를 함수 밖 깃발로 들고, 끝날 때까지 두 번째 호출을 그냥 흘린다. */
let EN_SAVING = false;
async function enSave() {
  if (EN_SAVING) return;
  EN_SAVING = true;
  try { return await enSaveRun(); }
  finally { EN_SAVING = false; }
}

async function enSaveRun() {
  const amt = enQS('#en-amt');
  if (!amt) return;
  const n = Number(amt.value.replace(/[^\d]/g, ''));
  if (!n) { enQS('#en-serr').textContent = '금액을 입력하세요.'; amt.focus(); return; }
  if (!EN.catId) { enQS('#en-serr').textContent = '분류를 선택하세요.'; return; }
  enQS('#en-serr').textContent = '';
  enQS('#en-save').disabled = true;

  const raw = enQS('#en-merch').value.trim();
  let group = null, merchant = raw || null;
  if (raw.includes('›')) {
    const p = raw.split('›');
    group = p[0].trim() || null;
    merchant = p.slice(1).join('›').trim() || null;
  }
  const gb = enQS('#en-good').getAttribute('aria-pressed') === 'true' ? 'Good'
           : enQS('#en-bad').getAttribute('aria-pressed') === 'true' ? 'Bad' : null;

  const dupRow = {
    date: enQS('#en-date').value, amount: EN.neg ? -n : n,
    merchant: (raw.includes('›') ? raw.split('›').slice(1).join('›').trim() : raw) || null
  };
  if ((await lgDupes([dupRow])).length &&
      !confirm(`같은 날짜 · 금액 · 사용처의 기록이 이미 있습니다.
${dupRow.date} ${enComma(n)}원 ${dupRow.merchant || ''}

그래도 저장할까요?`)) {
    enQS('#en-save').disabled = false;
    return;
  }

  const { error } = await (await enClient()).from('transactions').insert({
    date: enQS('#en-date').value,
    category_id: EN.catId,
    amount: EN.neg ? -n : n,
    merchant_group: group,
    merchant: merchant,
    note: enQS('#en-note').value.trim() || null,
    good_bad: gb,
    company_paid: enQS('#en-co').getAttribute('aria-pressed') === 'true',
    is_fixed: enQS('#en-fx').getAttribute('aria-pressed') === 'true'
  });
  enQS('#en-save').disabled = false;
  if (error) { enQS('#en-serr').textContent = '저장하지 못했습니다. 다시 시도하세요.'; return; }

  if (merchant) EN.merchCat[merchant] = EN.catId;
  enToast(enComma(n) + '원 기록했습니다');
  lgTouched();
  /* 전체 내역 화면이 열려 있으면 새로고침 없이 방금 넣은 기록이 바로 보이게 다시 읽는다 */
  enLoadLedger();
  amt.value = ''; enQS('#en-merch').value = ''; enQS('#en-note').value = '';
  EN.neg = false; EN.catId = null;
  amt.classList.remove('neg');
  ['#en-co', '#en-fx', '#en-good', '#en-bad'].forEach(x => enQS(x).setAttribute('aria-pressed', 'false'));
  enSyncCat();
  enQS('#en-merch').focus();
  enLoadRecent();
}

async function enLoadRecent() {
  const { data } = await (await enClient()).from('v_transactions')
    .select('id,date,kind,category,subcategory,emoji_category,amount,merchant,note,company_paid,is_fixed')
    .order('date', { ascending: false }).order('id', { ascending: false }).limit(8);
  const box = enQS('#en-recent');
  if (!box) return;
  if (!data || !data.length) { box.innerHTML = '<div class="en-empty">아직 기록이 없습니다.</div>'; return; }
  box.innerHTML = data.map(r => `
    <div class="en-row">
      <span aria-hidden="true">${r.emoji_category || ''}</span>
      <div class="m">
        <div class="l1">${enEsc(r.merchant || r.subcategory)}${r.company_paid ? ' 🏢' : ''}${r.is_fixed ? ' 📌' : ''}</div>
        <div class="l2">${String(r.date).slice(5).replace('-', '.')}<span class="dv">·</span>${enEsc(r.subcategory)}</div>
      </div>
      <span class="v ${r.kind}">${Number(r.amount) < 0 ? '−' : ''}${enComma(Math.abs(r.amount))}</span>
      <button class="en-del" data-id="${r.id}" aria-label="삭제">×</button>
    </div>`).join('');
  box.querySelectorAll('.en-del').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    await (await enClient()).from('transactions').delete().eq('id', Number(b.dataset.id));
    enToast('삭제했습니다');
    enLoadRecent();
  }));
}
