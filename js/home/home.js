/* ---------------- page: 자산 ---------------- */



/* 홈 — 두 축(현금흐름·자산)이 만나는 단 하나의 화면.
   "이번 달 자산이 얼마 늘었고, 그게 아껴서인지 굴려서인지"를 먼저 보여준다.
   본체는 아래 renderSavingFlowPage 를 그대로 쓴다. */
/* 홈에 올릴 목표는 이번 분기 것만. 시기가 반기 단위로 적혀 있으면 그 반기에
   이번 분기가 포함되는지로 판단한다. 시기가 비어 있는 목표는 홈에 올리지 않는다. */
/* ---------------- 홈 ----------------
   홈은 '지금 어떤가'만 본다. 판단·목표·거래내역은 각자의 화면이 있으니 여기서 겹치지 않는다.
   이번 달 더 쓸 수 있는 돈 → 최근 3달 추이 순으로, 가운데 한 줄로만 쌓는다. */

/* 이번 달을 마지막에 두는 최근 N개월 키 */
function hmRecentMonths(n) {
  const cur = thisMonthKey();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonthKey(cur, -i));
  return out;
}

/* 세 달치 막대 한 장. 숫자를 먼저 읽고, 막대는 크기 비교만 돕는다.
   goodUp = 늘어나는 게 좋은 항목인지 (투자·비상금은 O, 고정비는 X). */
function hmTrendCard(title, note, months, values, tone, goodUp) {
  const max = Math.max(...values.map(v => Math.abs(v)), 1);
  const last = values[values.length - 1];
  const prev = values.length > 1 ? values[values.length - 2] : null;
  const diff = prev === null ? null : last - prev;
  const good = diff === null || diff === 0 ? null : (diff > 0) === !!goodUp;
  const rows = months.map((k, i) => {
    const mo = Number(k.split('-')[1]);
    const isNow = i === months.length - 1;
    return `<div class="hm-trw${isNow ? ' now' : ''}">
      <span class="m">${mo}월${isNow ? '<i>진행 중</i>' : ''}</span>
      <span class="b"><i class="t-${tone}" style="width:${(Math.abs(values[i]) / max) * 100}%"></i></span>
      <span class="v mono">${formatKrw(values[i])}</span>
    </div>`;
  }).join('');
  /* 이번 달은 아직 안 끝났으니 '지난달 대비'는 지난 두 달로 비교한다 —
     반쯤 지난 달을 다 지난 달과 견주면 늘 줄어든 것처럼 보인다. */
  const cmp = values.length >= 3
    ? { a: values[values.length - 3], b: values[values.length - 2],
        la: months[months.length - 3], lb: months[months.length - 2] }
    : null;
  let foot = '';
  if (cmp) {
    const dv = cmp.b - cmp.a;
    const g = dv === 0 ? null : (dv > 0) === !!goodUp;
    foot = `<div class="hm-trd">${Number(cmp.la.split('-')[1])}월 → ${Number(cmp.lb.split('-')[1])}월
      <b class="${g === null ? '' : g ? 'up' : 'down'}">${dv === 0 ? '동일'
        : (dv > 0 ? '+' : '−') + formatKrw(Math.abs(dv))}</b></div>`;
  }
  return `<section class="hm-box">
    <div class="hm-hd"><b>${title}</b><span>${note}</span></div>
    <div class="hm-tr">${rows}</div>
    ${foot}
  </section>`;
}

function renderHomePage(container, data, d) {
  const ledger = data.ledger || [];
  const now = new Date();
  const mk = thisMonthKey();
  const dayKey = todayDayKey();

  const isIncome  = (r) => r.major.includes('수입');
  const isExpense = (r) => r.major.includes('지출');
  const isInvTr   = (r) => r.major.includes('이체') && String(r.minor || '').includes('투자');
  const isEmgTr   = (r) => r.major.includes('이체') && String(r.minor || '').includes('비상금');

  /* --- 이번 달 --- */
  const curM = ledger.filter(r => ledgerMonthKey(r.date) === mk);
  const mIn  = curM.filter(isIncome).reduce((a, r) => a + r.amount, 0);
  const mOut = curM.filter(isExpense).reduce((a, r) => a + netExpenseOf(r), 0);
  const mNet = mIn - mOut;
  const mRate = mIn > 0 ? (mNet / mIn) * 100 : null;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  /* 더 써도 되는 돈 = 이번 달 예산 − 쓴 돈. 예산을 안 적었으면 최근 12개월 평균 지출을 예산으로 본다 */
  const hasBudget = budgetMonthlyTotal() > 0;
  const budget = budgetPaceMonthly(data);
  const left = budget - mOut;
  const daysLeft = days - now.getDate() + 1;
  const perDay = left > 0 ? left / daysLeft : 0;
  const usedPct = budget > 0 ? Math.min(100, (mOut / budget) * 100) : 0;
  const dayPct = (now.getDate() / days) * 100;
  const todayOut = ledger.filter(r => ledgerDayKey(r.date) === dayKey && isExpense(r)).reduce((a, r) => a + netExpenseOf(r), 0);

  /* --- 최근 3달 --- */
  const months = hmRecentMonths(3);
  const monthSum = (key, pick, val) => ledger
    .filter(r => ledgerMonthKey(r.date) === key && pick(r))
    .reduce((a, r) => a + (val ? val(r) : Math.abs(r.amount)), 0);
  const fixedSeries = months.map(k => monthSum(k, r => r.fixed && isExpense(r), netExpenseOf));
  /* 이체는 출금(음수)도 섞여 있으므로 부호를 살려 순입금으로 센다 — 리포트 화면들과 같은 숫자 */
  const invSeries   = months.map(k => monthSum(k, isInvTr, r => r.amount));
  const emgSeries   = months.map(k => monthSum(k, isEmgTr, r => r.amount));

  const checks = hmChecks(data);
  const sig = checks.map(c => c.text).join('|');
  let hidden = '';
  try { hidden = localStorage.getItem('haedal:checks-hidden') || ''; } catch (e) {}
  const showChecks = checks.length && hidden !== sig;
  container.innerHTML = `
    <div class="hm-wrap">
      ${showChecks ? `<div class="hm-checks"><b>확인할 것</b>${checks.map(c =>
        `<button class="hm-chk" data-go="${c.go}">${c.text}</button>`).join('')}
        <button class="hm-chkx" id="hm-chkx" title="이 내용이 바뀔 때까지 숨기기">숨기기</button></div>` : ''}
      <section class="hm-box hm-main">
        <div class="hm-hd"><b>이번 달 더 쓸 수 있는 돈</b>
          <span>${monthKeyLabel(mk)} · ${daysLeft}일 남음</span></div>
        <div class="hm-tri">
          <div><span>남은 예산</span><b class="mono" style="color:${left >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${left >= 0 ? '' : '−'}${formatKrw(Math.abs(left))}</b></div>
          <div><span>하루에</span><b class="mono">${left > 0 ? formatKrw(perDay) : '0원'}</b></div>
          <div><span>쓴 돈</span><b class="mono out">${formatKrw(mOut)}</b></div>
        </div>
        ${budget > 0 ? `<div class="hm-budbar" title="예산 ${formatKrw(budget)} 중 ${usedPct.toFixed(0)}% 사용 · 달의 ${dayPct.toFixed(0)}% 지남">
          <i class="${mOut > budget * dayPct / 100 ? 'over' : ''}" style="width:${usedPct}%"></i><em style="left:${dayPct}%"></em></div>` : ''}
        <div class="hm-paceS">${left < 0 ? `예산보다 <b class="out">${formatKrw(-left)}</b> 더 썼어요 · ` : ''}예산 ${formatKrw(budget)}${hasBudget ? '' : ' (최근 12개월 평균)'}
          · 오늘 ${formatKrw(todayOut)} 씀 · 수입 ${formatKrw(mIn)}${mRate === null ? '' : ` · 저축률 <b>${mRate.toFixed(1)}%</b>`} ·
          <button class="hm-lnk" data-go="${hasBudget ? 'report/monthly' : 'set/budget'}">${hasBudget ? '월간 리포트' : '예산 정하기'}</button></div>
      </section>

      <div class="hm-row hm-row3">
      ${hmTrendCard('고정비', '최근 3달', months, fixedSeries, 'fx', false)}
      ${hmTrendCard('투자 이체', '최근 3달', months, invSeries, 'inv', true)}
      ${hmTrendCard('비상금 이체', '최근 3달', months, emgSeries, 'emg', true)}
      </div>
    </div>`;

  const hx = container.querySelector('#hm-chkx');
  if (hx) hx.addEventListener('click', () => {
    try { localStorage.setItem('haedal:checks-hidden', sig); } catch (e) {}
    hx.parentElement.remove();
  });
  container.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const [p, v] = b.dataset.go.split('/');
    goTo(p, v);
  }));
}



function renderAssetsPage(container, data, d) {
  container.innerHTML = `
    <div class="g">
      <div class="stat-grid s3" style="grid-template-columns:1fr;" id="panel-asset-stats"></div>
      <div class="panel s9" id="panel-trend"></div>
    </div>
    <div class="g">
      <div class="panel s5" id="panel-allocation"></div>
      <div class="panel s7" id="panel-accounts"></div>
    </div>
    <div class="nw-detail-hd">
      <b>계좌별 상세</b>
      <div class="range-toggle" id="nw-detail-toggle">
        <button data-sc="pension" class="${state.nwDetail !== 'saving' ? 'active' : ''}">연금</button>
        <button data-sc="saving" class="${state.nwDetail === 'saving' ? 'active' : ''}">저축</button>
      </div>
    </div>
    <div id="nw-detail"></div>
  `;
  renderAssetStats(data, d);
  renderAccountsPanel(data, d);
  renderTrend(data, d);
  renderAllocation(d);
  /* 예전 '리포트 › 연금 / 저축' 화면을 순자산 아래로 합쳤다 */
  renderSavingsPage(document.getElementById('nw-detail'), data, d, state.nwDetail === 'saving' ? 'saving' : 'pension');
  document.getElementById('nw-detail-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sc]');
    if (!b) return;
    state.nwDetail = b.dataset.sc;
    renderPage();
  });
}

function renderAssetStats(data, d) {
  const box = document.getElementById('panel-asset-stats');
  const latestMonth = d.latestMonth;
  const accSum = (pred) => data.assetRows
    .filter(r => r.date === latestMonth && r.amount !== null && pred(r.account, r.category))
    .reduce((a, r) => a + r.amount, 0);
  /* 대표 증권 계좌: 설정값, 없으면 이번 달 가장 큰 투자 자산 계좌 */
  const invRows = data.assetRows.filter(r => r.date === latestMonth && r.category === '투자 자산' && r.amount !== null);
  const brokerName = (state.settings.brokerAccount && invRows.some(r => sameAcct(r.account, state.settings.brokerAccount)))
    ? state.settings.brokerAccount
    : ((invRows.slice().sort((a, b) => b.amount - a.amount)[0] || {}).account || '');
  const toss = brokerName ? accSum((name) => sameAcct(name, brokerName)) : 0;
  const emgAcctName = state.settings.emergencyAccount || '';
  const pension = (d.allocation && d.allocation['연금 자산']) || 0;
  const emgTarget = state.goals.emergencyFundTarget || 0;
  const emgPct = emgTarget > 0 ? Math.min((d.emergencyFund / emgTarget) * 100, 999) : null;
  const emgDone = emgPct !== null && emgPct >= 100;
  const pct = (v) => d.totalAssets ? ((v / d.totalAssets) * 100).toFixed(0) + '%' : '—';
  const debt = totalDebt();
  const netWorth = d.totalAssets - debt;
  const cfList = d.cashflow || [];
  const closedExp = cfList.filter(c => c.expense > 0).slice(-6).map(c => c.expense);
  const avgMonthlyExpense = closedExp.length ? closedExp.reduce((a, b) => a + b, 0) / closedExp.length : 0;
  const livingCost = avgMonthlyExpense + monthlyDebtPayment();
  const emgMonths = livingCost > 0 ? d.emergencyFund / livingCost : null;
  const emgMonthTarget = state.settings.emergencyMonths || 6;

  box.innerHTML = `
      <div class="stat-card">
        <div class="label">순자산 <em style="font-style:normal;color:var(--text-faint);font-size:10px;">${latestMonth || ''}</em></div>
        <div class="value">${formatCompactWon(netWorth)}원</div>
        <div class="sub ${d.deltaAssets >= 0 ? 'good' : 'warn'}">전월 ${d.deltaAssets >= 0 ? '▲' : '▼'} ${formatCompactWon(Math.abs(d.deltaAssets))}원 (${d.deltaPct === null ? '—' : d.deltaPct.toFixed(1) + '%'})</div>
        <div class="sub" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span>자산 ${formatCompactWon(d.totalAssets)} − 부채 ${debt ? formatCompactWon(debt) : '0'}</span>
          <button class="btn small" id="debt-edit">부채 ${debt ? '수정' : '등록'}</button>
        </div>
      </div>
      <div class="stat-card">
        <div class="label">비상금${emgAcctName ? ` (${enEsc(emgAcctName)})` : ''}</div>
        <div class="value" style="color:${emgDone ? 'var(--income-text)' : 'var(--accent-text)'}">${formatCompactWon(d.emergencyFund)}원</div>
        <div class="sub ${emgPct === null ? '' : emgPct >= 100 ? 'good' : emgPct >= 60 ? 'warn' : 'bad'}">목표 ${formatCompactWon(emgTarget)}원 · 달성 ${emgPct === null ? '—' : emgPct.toFixed(0) + '%'}</div>
        <div class="allow-track" style="margin-top:7px;height:7px;">
          <div class="allow-fill" style="width:${emgPct === null ? 0 : Math.min(emgPct, 100)}%;${emgDone ? '' : 'background:linear-gradient(90deg,var(--gold),var(--gold-soft));'}"></div>
        </div>
        <div class="allow-legend"><span>${emgDone ? '목표 달성' : `${formatCompactWon(Math.max(emgTarget - d.emergencyFund, 0))}원 남음`}</span><span>${formatCompactWon(emgTarget)}원</span></div>
        <div class="sub ${emgMonths !== null && emgMonths >= emgMonthTarget ? 'good' : 'warn'}">${emgMonths === null ? '월 지출 데이터 부족' : `생활비 <b>${emgMonths.toFixed(1)}개월치</b> · 목표 ${emgMonthTarget}개월 (월 ${formatCompactWon(Math.round(livingCost))})`}</div>
      </div>
      <div class="stat-card">
        <div class="label">${brokerName ? enEsc(brokerName) : '대표 증권 계좌'}</div>
        <div class="value">${formatCompactWon(toss)}원</div>
        <div class="sub">총자산의 ${pct(toss)}</div>
      </div>
      <div class="stat-card">
        <div class="label">연금 전체</div>
        <div class="value" style="color:var(--net-fill)">${formatCompactWon(pension)}원</div>
        <div class="sub">총자산의 ${pct(pension)}</div>
      </div>
  `;
  const de = document.getElementById('debt-edit');
  if (de) de.addEventListener('click', openDebtEditor);
}

function renderAccountsPanel(data, d) {
  const panel = document.getElementById('panel-accounts');
  const latestMonth = d.latestMonth;
  const accounts = {};
  data.assetRows.filter(r => r.date === latestMonth && r.amount !== null).forEach(r => {
    accounts[r.account] = { amount: (accounts[r.account] ? accounts[r.account].amount : 0) + r.amount, category: r.category };
  });
  const accountList = Object.entries(accounts).sort((a, b) => b[1].amount - a[1].amount);
  panel.innerHTML = `
    <div class="panel-title"><div>계좌별 잔액</div><span class="ptag">${latestMonth || ''}</span></div>
    <div class="acct-board">
      ${ACCT_BOARD_ORDER.map(cat => {
        const list = accountList.filter(([, v]) => v.category === cat);
        if (!list.length) return '';
        const sum = list.reduce((a, [, v]) => a + v.amount, 0);
        const catPct = d.totalAssets ? (sum / d.totalAssets) * 100 : 0;
        return `<div class="acct-col" style="--catc:${CAT_COLORS[cat] || '#888'}">
          <div class="acct-col-head"><b>${cat.replace(' 자산', '')}</b><span>${formatCompactWon(sum)}<em>${catPct.toFixed(0)}%</em></span></div>
          ${list.map(([name, v]) => {
            const pct = sum ? (v.amount / sum) * 100 : 0;
            return `<div class="acct-cell">
              <span class="acct-nm">${name}</span>
              <span class="acct-val">${formatCompactWon(v.amount)}</span>
              <span class="acct-bar"><i style="width:${pct}%"></i></span>
            </div>`;
          }).join('')}
        </div>`;
      }).join('') || '<div class="empty-state">계좌 데이터가 없어요.</div>'}
    </div>
  `;
}

/* ---------------- page: 수입 ---------------- */


function bindRangeToggle(elId, options, currentVal, onPick) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = options.map(([v, l]) => `<button data-r="${v}" class="${String(currentVal) === String(v) ? 'active' : ''}">${l}</button>`).join('');
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    onPick(btn.dataset.r);
  });
}

const RANGE_OPTIONS = [['6', '6개월'], ['12', '1년'], ['24', '2년'], ['all', '전체']];

function sliceByRange(arr, range) {
  if (range === 'all' || !range) return arr;
  const n = parseInt(range, 10);
  return arr.slice(-n);
}










/* ---------------- 카테고리별 예산 가이드 + 이번 달 주요 지출 (같은 연월 기준, 동시 업데이트) ---------------- */

function pivotYearMonth(m) {
  const match = (m || '').match(/(\d{4})-(\d{1,2})월/);
  return match ? { year: match[1], month: parseInt(match[2], 10) } : { year: '', month: 0 };
}

/* 분류 › 세부분류별 최근 12개월 월평균 실지출 — 예산을 안 적었을 때 페이스 선의 기준 */
function buildBudgetTree(data) {
  const rows = (data.ledger || []).filter(r => r.major.includes('지출'));
  const keys = Array.from(new Set(rows.map(r => ledgerMonthKey(r.date)).filter(Boolean))).sort();
  const last12 = keys.slice(-12);
  const n = last12.length || 1;
  const tree = {};
  rows.forEach(r => {
    const mk = ledgerMonthKey(r.date);
    const minor = r.minor || '기타';
    const item = r.item || '기타';
    tree[minor] = tree[minor] || { name: minor, items: {} };
    const it = tree[minor].items[item] = tree[minor].items[item] || { name: item, sum12: 0, byMonth: {} };
    if (last12.includes(mk)) it.sum12 += netExpenseOf(r);
    it.byMonth[mk] = (it.byMonth[mk] || 0) + netExpenseOf(r);
  });
  const groups = Object.values(tree).map(g => {
    const items = Object.values(g.items).map(it => ({ ...it, avg: it.sum12 / n }))
      .filter(it => it.avg > 0).sort((a, b) => b.avg - a.avg);
    return { name: g.name, items, avg: items.reduce((a, x) => a + x.avg, 0) };
  }).filter(g => g.items.length).sort((a, b) => b.avg - a.avg);
  return { groups, months: keys, n };
}

/* ---------------- 예산 저장 형식 ----------------
   app_settings.budget_categories =
     { 분류: { amount, memo, items: { 세부분류: { amount, memo } } } }
   세부분류에 금액이 하나라도 있으면 분류 예산 = 세부분류 합계, 없으면 분류에 직접 적은 amount.
   예전 형식({ 분류: 숫자 }, { "분류|세부분류": 숫자 })도 그대로 읽어 들인다. */
function budgetNorm(raw) {
  const out = {};
  const grp = (c) => out[c] || (out[c] = { amount: 0, memo: '', items: {} });
  Object.entries(raw || {}).forEach(([k, v]) => {
    if (k.includes('|')) {
      const [c, it] = k.split('|');
      const n = Number(v) || 0;
      if (n) grp(c).items[it] = { amount: n, memo: '' };
      return;
    }
    const g = grp(k);
    if (v === null || typeof v !== 'object') { g.amount = Number(v) || 0; return; }
    g.amount = Number(v.amount) || 0;
    g.memo = v.memo || '';
    Object.entries(v.items || {}).forEach(([n, x]) => {
      const o = (x && typeof x === 'object') ? x : { amount: x };
      g.items[n] = { amount: Number(o.amount) || 0, memo: o.memo || '' };
    });
  });
  return out;
}
function budgetItemSum(g) {
  return Object.values((g && g.items) || {}).reduce((a, x) => a + (Number(x.amount) || 0), 0);
}
/* 분류 예산 — 세부분류 합계가 있으면 그것, 없으면 직접 적은 값 */
function budgetCatAmount(g) {
  if (!g) return 0;
  const s = budgetItemSum(g);
  return s > 0 ? s : (Number(g.amount) || 0);
}
function budgetMonthlyTotal(map) {
  return Object.values(map || state.budgets || {}).reduce((a, g) => a + budgetCatAmount(g), 0);
}
/* 예산 페이스 선 — 적어 둔 예산이 있으면 그 합계, 없으면 최근 12개월 평균 */
function budgetPaceMonthly(data) {
  const t = budgetMonthlyTotal();
  if (t > 0) return t;
  try {
    return buildBudgetTree(data).groups.reduce((a, g) => a + g.avg, 0);
  } catch (e) { return 0; }
}

/* ---------------- 데이터 점검 ----------------
   숫자가 틀리면 나머지 화면이 다 틀린다. 홈 맨 위에 '고칠 것'만 한 줄로 세운다. */
function hmChecks(data) {
  const out = [];
  const ledger = data.ledger || [];
  const now = new Date();
  /* 1) 분류 없는 거래 (최근 90일) */
  const since = new Date(now.getTime() - 90 * 864e5).toISOString().slice(0, 10);
  const noCat = ledger.filter(r => r.dayKey >= since && !r.catId).length;
  if (noCat) out.push({ text: `분류 없는 기록 ${noCat}건`, go: 'entry/ledger' });
  /* 2) 같은 날 · 같은 금액 · 같은 사용처가 두 번 (최근 60일) — 중복 입력 의심 */
  const since2 = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  const seen = {}; let dup = 0;
  ledger.filter(r => r.dayKey >= since2 && r.merch).forEach(r => {
    const k = `${r.dayKey}|${r.amount}|${r.merch}`;
    if (seen[k]) dup++; else seen[k] = 1;
  });
  if (dup) out.push({ text: `중복 의심 ${dup}건`, go: 'entry/ledger' });
  /* 3) 지난달 월말 결산(스냅샷)을 아직 안 적었다 — 매달 1~10일 사이에만 알린다 */
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pNum = pm.getFullYear() * 100 + pm.getMonth() + 1;
  const hasPrev = (data.assetRows || []).some(r => assetMonthKey(String(r.date || '')) === pNum);
  if (now.getDate() <= 10 && !hasPrev) out.push({ text: `${pm.getMonth() + 1}월 결산 안 함`, go: 'entry/snapshot' });
  /* 4) 토스 수집이 하루 넘게 멈췄다 */
  const s = data.toss && data.toss.summary;
  if (s) {
    const f = tossFreshness(s.asOf);
    if (f.mins != null && f.mins > 24 * 60) out.push({ text: `토스 수집 멈춤 (${f.text})`, go: 'invest/book' });
  }
  return out;
}
