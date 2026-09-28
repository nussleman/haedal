/* ================= 할 일 › 고정비 =================
   📌 로 찍은 '지출' 거래를 사용처별로 묶어 월·연 얼마인지 환산한다.

   금액 계산에서 주의한 것 두 가지.
   ① 진행 중인 달은 아직 결제가 다 안 들어왔으므로 계산에서 제외한다.
      (이걸 넣으면 월초에 볼 때마다 금액이 실제보다 작게 나온다)
   ② 월 금액은 '최근 한 달'이 아니라 관측 구간 전체의 평균이다.
      연 1회 결제(연회비 등)도 12로 나눠 월 환산이 되게 하기 위해서다. */
const FX_KEY = 'fixedreview';
const FX = { rows: [], verdict: {}, err: null };

const FX_LABEL = { keep: '그대로', watch: '줄일 후보', cancel: '끊기' };

function fxMonthKey(d) { return String(d).slice(0, 7); }
function fxMonthNo(k) { return Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)); }
function fxShiftMonth(k, n) {
  const t = fxMonthNo(k) + n - 1;
  return String(Math.floor(t / 12)).padStart(4, '0') + '-' + String(t % 12 + 1).padStart(2, '0');
}

async function fxLoadVerdict() {
  try {
    const r = await window.storage.get(FX_KEY, false);
    FX.verdict = r && r.value ? JSON.parse(r.value) : {};
  } catch (e) { FX.verdict = {}; }
}
async function fxSaveVerdict() {
  try { await window.storage.set(FX_KEY, JSON.stringify(FX.verdict), false); } catch (e) {}
}

async function fxLoad() {
  FX.err = null;
  const nowM = fxMonthKey(enToday());
  const lastComplete = fxShiftMonth(nowM, -1);      // 계산에 쓰는 마지막 달
  const since = fxShiftMonth(nowM, -13) + '-01';    // 넉넉히 13개월치를 읽는다

  let rows = [];
  try {
    const { data, error } = await (await enClient()).from('v_transactions')
      .select('date,kind,amount,merchant,note,is_fixed')
      .eq('is_fixed', true)
      .gte('date', since)
      .order('date', { ascending: false })
      .limit(3000);
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    FX.err = e.message || String(e);
    FX.rows = [];
    return;
  }

  const by = {};
  rows.forEach(r => {
    if (String(r.kind || '') !== '지출') return;    // 이체·수입에 붙은 📌 는 고정비가 아니다
    const m = String(r.merchant || '').trim();
    if (!m) return;
    const mk = fxMonthKey(r.date);
    if (!by[m]) by[m] = { merchant: m, byMonth: {}, last: r.date, lastAmt: Math.abs(Number(r.amount) || 0) };
    by[m].byMonth[mk] = (by[m].byMonth[mk] || 0) + Math.abs(Number(r.amount) || 0);
    if (r.date > by[m].last) { by[m].last = r.date; by[m].lastAmt = Math.abs(Number(r.amount) || 0); }
  });

  const today = enToday();
  const dayGap = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  FX.rows = Object.values(by).map(o => {
    /* 진행 중인 달은 뺀다 */
    const keys = Object.keys(o.byMonth).filter(k => k <= lastComplete).sort();
    if (!keys.length) {
      return { ...o, monthly: 0, annual: 0, span: 0, hit: 0, upPct: null,
               gapDays: dayGap(o.last, today), recent: [], partialOnly: true };
    }
    /* 관측 구간 = 첫 기록이 있는 달부터 지난달까지 (최대 12개월) */
    const span = Math.min(12, fxMonthNo(lastComplete) - fxMonthNo(keys[0]) + 1);
    const useFrom = fxShiftMonth(lastComplete, -(span - 1));
    const used = keys.filter(k => k >= useFrom);
    const sum = used.reduce((a, k) => a + o.byMonth[k], 0);

    /* 매달 나가는 것과 가끔 나가는 것(연회비 등)을 나눠서 환산한다.
       관측 구간의 60% 이상 달에 등장하면 '매달형'으로 보고 구간 평균을 쓰고,
       그보다 드물면 1년 주기로 보고 12로 나눈다.
       (그냥 구간으로 나누면 6개월 전 한 번 낸 연회비가 월 2만원으로 잡힌다) */
    const isMonthly = used.length >= Math.max(2, Math.ceil(span * 0.6));
    const monthly = isMonthly ? (sum / span) : (sum / 12);

    /* 인상 감지 — 최근 3개월 평균과 그 앞 구간 평균 (둘 다 값이 있을 때만) */
    let upPct = null;
    if (used.length >= 6) {
      const tail = used.slice(-3), head = used.slice(0, -3);
      const tAvg = tail.reduce((a, k) => a + o.byMonth[k], 0) / tail.length;
      const hAvg = head.reduce((a, k) => a + o.byMonth[k], 0) / head.length;
      if (hAvg > 0) upPct = ((tAvg - hAvg) / hAvg) * 100;
    }

    return {
      ...o, monthly, annual: monthly * 12, span, hit: used.length, upPct, isMonthly,
      gapDays: dayGap(o.last, today),
      recent: used.slice(-3).map(k => ({ k, v: o.byMonth[k] })),
      partialOnly: false
    };
  }).sort((a, b) => b.annual - a.annual);
}

async function renderFixedPage(body) {
  body.innerHTML = '<div class="lg-wrap"><div class="en-empty">고정비를 불러오는 중…</div></div>';
  await fxLoadVerdict();
  await fxLoad();
  fxPaint(body);
}

function fxPaint(body) {
  if (FX.err) {
    body.innerHTML = `<div class="lg-wrap"><div class="en-empty">고정비를 불러오지 못했습니다 — ${enEsc(FX.err)}</div></div>`;
    return;
  }
  if (!FX.rows.length) {
    body.innerHTML = `<div class="lg-wrap"><div class="en-empty">📌 고정비로 표시된 지출이 없어요.<br>
      기록할 때 📌 고정비를 켜두면 여기 모입니다.</div></div>`;
    return;
  }

  const vOf = (m) => (FX.verdict[m] && FX.verdict[m].v) || null;
  const alive = FX.rows.filter(r => vOf(r.merchant) !== 'cancel');
  const cut = FX.rows.filter(r => vOf(r.merchant) === 'cancel');
  const todo = FX.rows.filter(r => !vOf(r.merchant));

  const moTotal = alive.reduce((a, r) => a + r.monthly, 0);
  const cutYear = cut.reduce((a, r) => a + r.annual, 0);
  const order = [...todo, ...alive.filter(r => vOf(r.merchant)), ...cut];

  const rowHtml = (r) => {
    const v = vOf(r.merchant);
    const flags = [];
    if (r.upPct !== null && r.upPct >= 5) flags.push(`<span class="fx-flag up">↑ ${r.upPct.toFixed(0)}%</span>`);
    if (r.gapDays > 45) flags.push(`<span class="fx-flag gap">${r.gapDays}일째 결제 없음</span>`);
    if (r.span > 0 && !r.isMonthly) flags.push(`<span class="fx-flag">가끔 결제 · ${r.span}개월 중 ${r.hit}번</span>`);
    else if (r.span > 0 && r.hit < r.span) flags.push(`<span class="fx-flag">${r.span}개월 중 ${r.hit}번</span>`);
    const btn = (val) =>
      `<button data-m="${enEsc(r.merchant)}" data-v="${val}" class="${v === val ? 'on' : ''}">${FX_LABEL[val]}</button>`;
    const recent = r.recent.length
      ? r.recent.map(x => `${x.k.slice(5)}월 ${wonComma(x.v)}`).join(' · ')
      : '지난달까지 기록 없음';
    return `<div class="fx-row${v === 'cancel' ? ' off' : ''}">
      <span class="fx-name">
        <b>${enEsc(r.merchant)}</b>
        <span class="fx-meta">${flags.join('')}<span>${recent}</span></span>
      </span>
      <span class="fx-num">
        <span class="mo">${wonComma(Math.round(r.monthly))}원</span>
        <span class="yr">연 ${formatCompactWon(r.annual)}원</span>
      </span>
      <span class="fx-acts">${btn('keep')}${btn('watch')}${btn('cancel')}</span>
    </div>`;
  };

  body.innerHTML = `
    <div class="lg-wrap">
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);gap:8px;">
        <div class="stat-card">
          <div class="label">월 고정비</div>
          <div class="value">${formatKrw(moTotal)}</div>
          <div class="sub">'끊기' 표시분 제외</div>
        </div>
        <div class="stat-card">
          <div class="label">연 환산</div>
          <div class="value">${formatKrw(moTotal * 12)}</div>
          <div class="sub">지금 이대로 1년</div>
        </div>
        <div class="stat-card">
          <div class="label">항목</div>
          <div class="value">${alive.length}개</div>
          <div class="sub">아직 안 본 것 ${todo.length}개</div>
        </div>
        <div class="stat-card">
          <div class="label">끊으면 아끼는 돈</div>
          <div class="value" style="color:var(--income-text)">${cutYear ? '+' + formatKrw(cutYear) : '—'}</div>
          <div class="sub">연 기준 · ${cut.length}건</div>
        </div>
      </div>

      <div class="panel" style="margin-top:12px;">
        <div class="panel-title"><div>고정비 목록</div><span class="ptag">연 환산 큰 순</span></div>
        <div class="settings-note" style="margin:0 0 8px;">
          오른쪽 세 버튼은 <b>내가 이걸 어떻게 하기로 했는지</b> 적어두는 표시예요.
          <b>그대로</b>는 손대지 않기로 한 것, <b>줄일 후보</b>는 나중에 다시 볼 것,
          <b>끊기</b>는 해지하기로 한 것. '끊기'로 두면 위 <b>끊으면 아끼는 돈</b>에 연 금액이 쌓입니다.
          같은 버튼을 다시 누르면 표시가 풀려요.
        </div>
        <div id="fx-list">${order.map(rowHtml).join('')}</div>
        <div class="settings-note" style="margin-top:10px;">
          월 금액은 <b>최근 ${Math.max(...FX.rows.map(r => r.span), 0)}개월까지의 평균</b>이에요.
          <b>가끔 결제</b>로 표시된 항목은 1년에 몇 번 나가는 것으로 보고 12로 나눠 월 환산합니다. <b>이번 달은 아직 결제가 다 안 들어와서 계산에서 뺐어요.</b>
          이름 아래 숫자는 최근 3개월 실제 결제액이라 눈으로 맞춰볼 수 있습니다.
          판정은 이 브라우저에만 저장돼요.
        </div>
      </div>
    </div>`;

  body.querySelectorAll('.fx-acts button').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.m, v = b.dataset.v;
    if (FX.verdict[m] && FX.verdict[m].v === v) delete FX.verdict[m];
    else FX.verdict[m] = { v, at: enToday() };
    fxSaveVerdict();
    fxPaint(body);
  }));
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

  const byCls = {};
  accounts.forEach(a => { (byCls[a.cls] = byCls[a.cls] || []).push(a); });
  const clsOrder = [...CAT_ORDER.filter(c => byCls[c]), ...Object.keys(byCls).filter(c => !CAT_ORDER.includes(c))];

  const rowHtml = (a) => {
    const c = cur[a.account], p = prev[a.account];
    const dv = c && p ? c.amount - p.amount : null;
    return `<div class="sn-row">
      <span class="ac">${enEsc(a.account)}</span>
      <span class="pv">${p ? wonComma(p.amount) : '—'}</span>
      <input class="en-in sn-in" inputmode="numeric" data-acct="${enEsc(a.account)}" data-cls="${enEsc(a.cls)}"
             value="${c ? wonComma(c.amount) : ''}" placeholder="미입력">
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
        </div>
        <div class="sn-acts">
          <button class="lg-reset" id="sn-fill">전월 값 채우기</button>
          <button class="bk-add" id="sn-save">저장</button>
        </div>
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
