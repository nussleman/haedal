/* ================= 현황 › 자산 스냅샷 =================
   달마다 계좌 잔액을 한 번 적어 두는 자리. Supabase asset_snapshots 가 유일한 원본이고,
   여기서 저장하면 자산·흐름·목표 화면이 같은 값을 그대로 쓴다. (시트는 더 이상 쓰지 않는다) */

const SNAP = { rows: [], accounts: [], accountsLoaded: false, month: null, uid: null, loaded: false, saving: false, extra: [], err: null };

/* 계좌 목록은 accounts 테이블이 원본이다 (목록 관리 › 계좌에서 고친다).
   과거 스냅샷에만 있고 목록에는 없는 계좌도 빠뜨리지 않고 함께 보여준다. */
async function snapLoadAccounts(force) {
  if (SNAP.accountsLoaded && !force) return;
  const sb = await enClient();
  const { data, error } = await sb.from('accounts')
    .select('id,name,asset_class,sort_order,is_active').order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  SNAP.accounts = data || [];
  SNAP.accountsLoaded = true;
}

function snapNowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function snapMonthKeyOf(v) { return String(v || '').slice(0, 7); }          /* '2026-09-01' → '2026-09' */
function snapMonthLabel(k) { return `${String(k).slice(2, 4)}년 ${String(k).slice(5, 7)}월`; }
function snapMonthShift(k, n) {
  const y = parseInt(k.slice(0, 4), 10), m = parseInt(k.slice(5, 7), 10);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/* DB 행 → 화면 곳곳이 쓰는 자산 행 모양 ('26년 09월') */
function snapRowToAssetRow(r) {
  return {
    date: snapMonthLabel(snapMonthKeyOf(r.month)),
    category: r.asset_class,
    account: r.account,
    amount: Number(r.amount) || 0
  };
}

async function snapLoad(force) {
  if (SNAP.loaded && !force) return;
  const sb = await enClient();
  if (!SNAP.uid) {
    const { data } = await sb.auth.getUser();
    SNAP.uid = data && data.user ? data.user.id : null;
  }
  const { data, error } = await sb.from('asset_snapshots')
    .select('id,month,asset_class,account,amount')
    .order('month', { ascending: true });
  if (error) throw new Error(error.message);
  SNAP.rows = (data || []).map(r => ({
    id: r.id, mk: snapMonthKeyOf(r.month), cls: r.asset_class,
    account: r.account, amount: Number(r.amount) || 0
  }));
  SNAP.loaded = true;
}

/* 입력 칸의 계좌 목록 = accounts 테이블 + 과거 스냅샷에 남아 있는 계좌 */
function snapAccounts() {
  const map = new Map();
  SNAP.accounts.filter(a => a.is_active !== false).forEach((a, i) =>
    map.set(a.name, { cls: a.asset_class, so: a.sort_order == null ? (i + 1) * 10 : a.sort_order }));
  SNAP.rows.forEach(r => { if (!map.has(r.account)) map.set(r.account, { cls: r.cls, so: 9000 }); });
  SNAP.extra.forEach(e => { if (!map.has(e.account)) map.set(e.account, { cls: e.cls, so: 9500 }); });
  const list = [...map.entries()].map(([account, v]) => ({ account, cls: v.cls, so: v.so }));
  const rank = (c) => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };
  return list.sort((a, b) => rank(a.cls) - rank(b.cls) || a.so - b.so || a.account.localeCompare(b.account, 'ko'));
}
function snapMonthRows(mk) {
  const m = {};
  SNAP.rows.forEach(r => { if (r.mk === mk) m[r.account] = r; });
  return m;
}
function snapMonthTotal(mk) {
  return SNAP.rows.reduce((a, r) => a + (r.mk === mk ? r.amount : 0), 0);
}
function snapMonthList() {
  const set = new Set(SNAP.rows.map(r => r.mk));
  set.add(snapNowMonth());
  if (SNAP.month) set.add(SNAP.month);
  return [...set].sort().reverse();
}
const snapNum = (v) => {
  const t = String(v == null ? '' : v).replace(/[^0-9-]/g, '');
  if (t === '' || t === '-') return null;
  const n = parseInt(t, 10);
  return isNaN(n) ? null : n;
};

/* 화면 전체가 같은 값을 보게 맞춘다 — 저장 직후 자산·흐름·목표가 바로 따라온다. */
function snapPushToDashboard() {
  if (!state.data) return;
  state.data = { ...state.data, assetRows: SNAP.rows.map(r => snapRowToAssetRow({
    month: r.mk + '-01', asset_class: r.cls, account: r.account, amount: r.amount
  })), assetSource: 'db' };
  applySuggestedGoals(state.data);
}


async function renderSnapshotPage(body) {
  body.innerHTML = '<div class="lg-wrap sn-wrap"><div class="en-empty">자산 스냅샷을 불러오는 중…</div></div>';
  try {
    await snapLoad(false);
    await snapLoadAccounts(false).catch(() => {});
    SNAP.err = null;
  } catch (e) {
    body.innerHTML = `<div class="lg-wrap sn-wrap"><div class="en-empty">자산 스냅샷을 불러오지 못했습니다 — ${enEsc(e.message || e)}</div></div>`;
    return;
  }
  if (!SNAP.month) SNAP.month = snapNowMonth();
  const mk = SNAP.month;
  const prevKey = snapMonthShift(mk, -1);
  const cur = snapMonthRows(mk), prev = snapMonthRows(prevKey);
  const accounts = snapAccounts();
  const months = snapMonthList();
  const filled = Object.keys(cur).length;
  const total = snapMonthTotal(mk), prevTotal = snapMonthTotal(prevKey);
  const diff = filled && prevTotal ? total - prevTotal : null;

  /* 월말 결산: 그 달의 흐름(가계부)과 쌓인 결과(스냅샷)를 한 화면에서 본다 */
  const mLedger = ((state.data && state.data.ledger) || []).filter(r => ledgerMonthKey(r.date) === mk);
  const fIn = mLedger.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0);
  const fOut = mLedger.filter(r => r.major.includes('지출')).reduce((a, r) => a + netExpenseOf(r), 0);
  const fInv = mLedger.filter(r => r.major.includes('이체') && String(r.minor || '').includes('투자')).reduce((a, r) => a + r.amount, 0);
  const fEmg = mLedger.filter(r => r.major.includes('이체') && String(r.minor || '').includes('비상금')).reduce((a, r) => a + r.amount, 0);
  const fRate = fIn > 0 ? ((fIn - fOut) / fIn) * 100 : null;
  const fBudget = budgetPaceMonthly(state.data || {});

  const byCls = {};
  accounts.forEach(a => { (byCls[a.cls] = byCls[a.cls] || []).push(a); });
  const clsOrder = [...CAT_ORDER.filter(c => byCls[c]), ...Object.keys(byCls).filter(c => !CAT_ORDER.includes(c))];

  /* 증권 계좌(설정 › 계좌에서 고른 것)는 토스 수집 값으로 미리 채운다 — 그 달 마지막 수집 기준 */
  const broker = (state.settings && state.settings.brokerAccount) || '';
  const tossDaily = (state.data && state.data.toss && state.data.toss.daily) || [];
  const tossAt = tossDaily.filter(x => x.date.slice(0, 7) === mk).pop() || null;
  const rowHtml = (a) => {
    const c = cur[a.account], p = prev[a.account];
    const auto = !c && tossAt && sameAcct(a.account, broker);
    const dv = c && p ? c.amount - p.amount : null;
    return `<div class="sn-row">
      <span class="ac">${enEsc(a.account)}</span>
      <span class="pv">${p ? wonComma(p.amount) : '—'}</span>
      <input class="en-in sn-in" inputmode="numeric" data-acct="${enEsc(a.account)}" data-cls="${enEsc(a.cls)}"
             value="${c ? wonComma(c.amount) : auto ? wonComma(tossAt.total) : ''}" placeholder="미입력"
             ${auto ? `title="토스 자동 (${tossAt.date.slice(5).replace('-', '/')} 기준) — 저장하면 기록돼요"` : ''}
             ${auto ? 'data-auto="1"' : ''}>
      <span class="dl ${dv > 0 ? 'up' : dv < 0 ? 'down' : ''}">${dv === null ? '' : (dv > 0 ? '+' : '') + wonComma(dv)}</span>
      <button class="sn-x" data-acct="${enEsc(a.account)}" title="이 달 값 비우기">×</button>
    </div>`;
  };

  body.innerHTML = `
    <div class="lg-wrap sn-wrap">
      <div class="sn-head">
        <div class="sn-mo">
          <button class="sn-nav" id="sn-prev" aria-label="이전 달">‹</button>
          <select class="en-in sn-sel" id="sn-msel">
            ${months.map(m => `<option value="${m}" ${m === mk ? 'selected' : ''}>${snapMonthLabel(m)}</option>`).join('')}
          </select>
          <button class="sn-nav" id="sn-next" aria-label="다음 달">›</button>
          <span class="sn-badge ${filled ? 'ok' : 'new'}">${filled ? `${filled}개 계좌 기록됨` : '미입력'}</span>
          ${tossAt && broker && !cur[broker] ? `<span class="sn-auto">증권 계좌는 토스 값(${tossAt.date.slice(5).replace('-', '/')})으로 채워 뒀어요</span>` : ''}
        </div>
        <div class="sn-acts">
          <button class="lg-reset" id="sn-fill">전월 값 채우기</button>
          <button class="bk-add" id="sn-save">저장</button>
        </div>
      </div>

      <div class="sn-flow">
        <div><span class="k">수입</span><b class="in">${formatKrw(fIn)}</b></div>
        <div><span class="k">지출</span><b class="out">${formatKrw(fOut)}</b>${fBudget > 0 ? `<em class="${fOut > fBudget ? 'down' : 'up'}">예산 ${fOut > fBudget ? '초과' : '안'} (${formatKrw(fBudget)})</em>` : ''}</div>
        <div><span class="k">저축률</span><b>${fRate === null ? '—' : fRate.toFixed(1) + '%'}</b></div>
        <div><span class="k">투자 이체</span><b>${formatKrw(fInv)}</b></div>
        <div><span class="k">비상금 이체</span><b>${formatKrw(fEmg)}</b></div>
      </div>

      <div class="sn-sum">
        <div><span class="k">${snapMonthLabel(mk)} 합계</span><b>${filled ? formatKrw(total) : '—'}</b></div>
        <div><span class="k">전월(${snapMonthLabel(prevKey)})</span><b>${prevTotal ? formatKrw(prevTotal) : '—'}</b></div>
        <div><span class="k">증감</span><b class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff === null ? '—' : (diff > 0 ? '+' : '') + formatKrw(diff)}</b></div>
      </div>

      <div class="sn-card">
        <div class="sn-cols"><span class="ac">계좌</span><span class="pv">전월</span><span class="in">${snapMonthLabel(mk)} 잔액</span><span class="dl">증감</span><span class="x"></span></div>
        ${clsOrder.map(c => `
          <div class="sn-cls"><i style="background:${CAT_COLORS[c] || 'var(--text-faint)'}"></i>${enEsc(c)}
            <b>${byCls[c].some(x => cur[x.account]) ? wonComma(byCls[c].reduce((a, x) => a + (cur[x.account] ? cur[x.account].amount : 0), 0)) : '—'}</b></div>
          ${byCls[c].map(rowHtml).join('')}`).join('')}
        <div class="sn-addrow">
          <select class="en-in" id="sn-newcls">${CAT_ORDER.map(c => `<option value="${enEsc(c)}">${enEsc(c)}</option>`).join('')}</select>
          <input class="en-in" id="sn-newacct" placeholder="새 계좌 이름">
          <button class="lg-reset" id="sn-addacct">+ 계좌 추가</button>
        </div>
      </div>

      <div class="sn-hist">
        <div class="sn-histhead">월별 기록</div>
        <table class="data-table">
          <thead><tr><th>월</th><th class="r">합계</th><th class="r">증감</th><th class="r">계좌</th></tr></thead>
          <tbody>
            ${months.filter(m => snapMonthTotal(m)).slice(0, 18).map(m => {
              const t = snapMonthTotal(m), pt = snapMonthTotal(snapMonthShift(m, -1));
              const dd = pt ? t - pt : null;
              return `<tr class="sn-hrow ${m === mk ? 'on' : ''}" data-m="${m}">
                <td>${snapMonthLabel(m)}</td>
                <td class="r mono">${wonComma(t)}</td>
                <td class="r mono ${dd > 0 ? 'up' : dd < 0 ? 'down' : ''}">${dd === null ? '—' : (dd > 0 ? '+' : '') + wonComma(dd)}</td>
                <td class="r mono">${Object.keys(snapMonthRows(m)).length}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const go = (m) => { SNAP.month = m; SNAP.extra = []; renderSnapshotPage(body); };
  document.getElementById('sn-prev').addEventListener('click', () => go(snapMonthShift(mk, -1)));
  document.getElementById('sn-next').addEventListener('click', () => go(snapMonthShift(mk, 1)));
  document.getElementById('sn-msel').addEventListener('change', (e) => go(e.target.value));
  body.querySelectorAll('.sn-hrow').forEach(tr => tr.addEventListener('click', () => go(tr.dataset.m)));

  body.querySelectorAll('.sn-in').forEach(el => {
    el.addEventListener('blur', () => {
      const n = snapNum(el.value);
      el.value = n === null ? '' : wonComma(n);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') snapSave(body); });
  });
  body.querySelectorAll('.sn-x').forEach(b => b.addEventListener('click', () => {
    const el = body.querySelector(`.sn-in[data-acct="${CSS.escape(b.dataset.acct)}"]`);
    if (el) { el.value = ''; el.focus(); }
  }));

  document.getElementById('sn-fill').addEventListener('click', () => {
    body.querySelectorAll('.sn-in').forEach(el => {
      if (snapNum(el.value) !== null) return;
      const p = prev[el.dataset.acct];
      if (p) el.value = wonComma(p.amount);
    });
    enToast('전월 값을 비어 있던 칸에만 채웠어요. 확인하고 저장하세요.');
  });

  const addAcct = () => {
    const name = (document.getElementById('sn-newacct').value || '').trim();
    const cls = document.getElementById('sn-newcls').value;
    if (!name) return;
    if (snapAccounts().some(a => a.account === name)) { enToast('이미 있는 계좌입니다'); return; }
    SNAP.extra.push({ account: name, cls });
    renderSnapshotPage(body);
    /* 계좌 목록(accounts)에도 등록해 둔다 — 다음 달부터 칸이 저절로 생긴다 */
    enClient().then(sb => sb.from('accounts').insert([{ name, asset_class: cls, sort_order: 9000 }]))
      .then(() => snapLoadAccounts(true)).catch(() => {});
  };
  document.getElementById('sn-addacct').addEventListener('click', addAcct);
  document.getElementById('sn-newacct').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAcct(); });
  document.getElementById('sn-save').addEventListener('click', () => snapSave(body));
}

/* 저장 — 값이 있는 칸은 넣거나 고치고, 비운 칸은 그 달 기록에서 지운다.
   (owner_id, month, account) 가 유일 키라서 같은 달 같은 계좌는 늘 한 줄만 남는다. */
async function snapSave(body) {
  if (SNAP.saving) return;
  const mk = SNAP.month, monthDate = mk + '-01';
  const cur = snapMonthRows(mk);
  const ups = [], dels = [];
  body.querySelectorAll('.sn-in').forEach(el => {
    const acct = el.dataset.acct, cls = el.dataset.cls;
    const n = snapNum(el.value);
    const ex = cur[acct];
    if (n === null) { if (ex) dels.push(ex.id); return; }
    if (ex && ex.amount === n && ex.cls === cls) return;
    ups.push({ owner_id: SNAP.uid, month: monthDate, asset_class: cls, account: acct, amount: n });
  });
  if (!ups.length && !dels.length) { enToast('바뀐 값이 없어요'); return; }

  SNAP.saving = true;
  const btn = document.getElementById('sn-save');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    const sb = await enClient();
    if (ups.length) {
      const { error } = await sb.from('asset_snapshots').upsert(ups, { onConflict: 'owner_id,month,account' });
      if (error) throw new Error(error.message);
    }
    if (dels.length) {
      const { error } = await sb.from('asset_snapshots').delete().in('id', dels);
      if (error) throw new Error(error.message);
    }
    await snapLoad(true);
    SNAP.extra = [];
    snapPushToDashboard();
    renderNav();
    enToast(`${snapMonthLabel(mk)} 저장했습니다 (${ups.length}건 반영${dels.length ? `, ${dels.length}건 삭제` : ''})`);
    renderSnapshotPage(body);
  } catch (e) {
    enToast('저장하지 못했습니다 — ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
  } finally {
    SNAP.saving = false;
  }
}
