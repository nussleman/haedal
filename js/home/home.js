/* ---------------- page: 자산 ---------------- */



/* 홈 — 두 축(현금흐름·자산)이 만나는 단 하나의 화면.
   "이번 달 자산이 얼마 늘었고, 그게 아껴서인지 굴려서인지"를 먼저 보여준다.
   본체는 아래 renderSavingFlowPage 를 그대로 쓴다. */
/* 홈에 올릴 목표는 이번 분기 것만. 시기가 반기 단위로 적혀 있으면 그 반기에
   이번 분기가 포함되는지로 판단한다. 시기가 비어 있는 목표는 홈에 올리지 않는다. */
/* ---------------- 홈 ----------------
   홈은 '지금 어떤가'만 본다. 판단·목표·거래내역은 각자의 화면이 있으니 여기서 겹치지 않는다.
   윗줄은 자산의 결과(층 1 순자산 · 층 2 저축률 · 층 3 자산 배분), 아랫줄은 이번 달 레버 넷
   (지출 · 고정비 · 투자 이체 · 비상금 이체)을 2×2로 세운다.
   상자 하나 = 제목 · 가장 큰 숫자 하나 · 흐린 설명 · (필요할 때만) 오른쪽 여백에 게이지. */

/* 이번 달 바로 전 N개월 키 (이번 달은 빼고, 오래된 것부터) */
function hmPrevMonths(n) {
  const cur = thisMonthKey();
  const out = [];
  for (let i = n; i >= 1; i--) out.push(shiftMonthKey(cur, -i));
  return out;
}

/* 반원 게이지. pct = 채울 비율(0~), mark = 눈금 위치(0~100, 달이 얼마나 지났는지 등) */
function hmGauge(pct, tone, label, mark) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const tick = (mark === null || mark === undefined) ? '' : (() => {
    const a = Math.PI * (1 - Math.max(0, Math.min(100, mark)) / 100);
    const x1 = 56 + Math.cos(a) * 38, y1 = 56 - Math.sin(a) * 38;
    const x2 = 56 + Math.cos(a) * 54, y2 = 56 - Math.sin(a) * 54;
    return `<line class="tk" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  })();
  return `<div class="hm-gauge g-${tone}">
    <svg viewBox="0 0 112 64" aria-hidden="true">
      <path class="tr" d="M10 56 A46 46 0 0 1 102 56" pathLength="100"/>
      ${p > 0 ? `<path class="fl" d="M10 56 A46 46 0 0 1 102 56" pathLength="100" stroke-dasharray="${p.toFixed(1)} 100"/>` : ''}
      ${tick}
    </svg>
    <b class="mono">${Math.round(pct || 0)}%</b><span>${label}</span>
  </div>`;
}

/* 상자 하나 */
function hmStatBox({ title, note, go, big, bigTone, sub, desc, gauge, extra, cls }) {
  return `<section class="hm-box hm-stat${gauge ? ' has-g' : ''}${cls ? ' ' + cls : ''}">
    <div class="hm-hd"><b>${title}</b>${go ? `<button class="hm-lnk" data-go="${go}">${note} ›</button>` : `<span>${note}</span>`}</div>
    <div class="hm-sb">
      <div class="hm-st">
        <div class="hm-big mono${bigTone ? ' ' + bigTone : ''}">${big}${sub ? `<small>${sub}</small>` : ''}</div>
        <div class="hm-desc">${desc.filter(Boolean).map(l => `<p>${l}</p>`).join('')}</div>
      </div>
      ${gauge || ''}
    </div>
    ${extra || ''}
  </section>`;
}

const hmSigned = (n) => (n < 0 ? '−' : '') + formatKrw(Math.abs(n));

function renderHomePage(container, data, d) {
  const ledger = data.ledger || [];
  const now = new Date();
  const mk = thisMonthKey();

  const isExpense = (r) => r.major.includes('지출');
  const isInvTr   = (r) => r.major.includes('이체') && String(r.minor || '').includes('투자');
  const isEmgTr   = (r) => r.major.includes('이체') && String(r.minor || '').includes('비상금');

  const curM = ledger.filter(r => ledgerMonthKey(r.date) === mk);
  const curExp = curM.filter(isExpense);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = days - now.getDate() + 1;
  const dayPct = (now.getDate() / days) * 100;

  /* 지난 3달 평균 — 이번 달은 아직 안 끝났으니 빼고 센다 */
  const prev = hmPrevMonths(3);
  const monthSum = (key, pick, val) => ledger
    .filter(r => ledgerMonthKey(r.date) === key && pick(r))
    .reduce((a, r) => a + val(r), 0);
  const avg3 = (pick, val) => prev.reduce((a, k) => a + monthSum(k, pick, val), 0) / prev.length;

  /* ① 이번 달 지출 — 전체 예산 대비 */
  const bs = budgetSplit(data, curExp);
  const mOut = bs.spent;
  const budget = bs.total;
  const leftAll = budget - mOut;
  const spendPct = budget > 0 ? (mOut / budget) * 100 : 0;
  const varLeft = bs.left;
  const perDay = varLeft > 0 ? varLeft / daysLeft : 0;
  const box1 = hmStatBox({
    title: '이번 달 지출', note: `${daysLeft}일 남음`, go: 'report/monthly',
    big: formatKrw(mOut),
    desc: [
      budget > 0
        ? (leftAll >= 0 ? `예산 ${formatKrw(budget)} 중 <b>${formatKrw(leftAll)}</b> 남음`
                        : `예산 ${formatKrw(budget)}보다 <b class="out">${formatKrw(-leftAll)}</b> 더 씀`)
          + (bs.has ? '' : ' (최근 12개월 평균)')
        : '예산을 아직 안 정했어요',
      bs.fixedBudget > 0
        ? `고정 빼고 쓸 수 있는 돈 ${hmSigned(varLeft)} · 하루 ${formatKrw(perDay)}`
        : `하루 ${formatKrw(perDay)}씩 쓸 수 있어요`
    ],
    gauge: budget > 0 ? hmGauge(spendPct, mOut > budget * dayPct / 100 ? 'over' : 'spend', '예산', dayPct) : ''
  });

  /* ② 고정비 — 나간 돈 + 아직 안 나간 📌 예산 = 이번 달 예상 */
  let fxExpected = 0;
  if (bs.has) {
    const lineSpent = (cat, item) => curExp
      .filter(r => (r.minor || '기타') === cat && (item === null || (r.item || '기타') === item))
      .reduce((a, r) => a + netExpenseOf(r), 0);
    Object.entries(state.budgets || {}).forEach(([cat, g]) => {
      if (g.fixed) { fxExpected += Math.max(budgetCatAmount(g), lineSpent(cat, null)); return; }
      Object.entries(g.items || {}).forEach(([it, x]) => {
        if (x.fixed) fxExpected += Math.max(Number(x.amount) || 0, lineSpent(cat, it));
      });
    });
  }
  fxExpected = Math.max(fxExpected, bs.fixedSpent);
  const fxAvg = avg3(r => r.fixed && isExpense(r), netExpenseOf);
  const fxRest = fxExpected - bs.fixedSpent;
  const box2 = hmStatBox({
    title: '이번 달 고정비', note: '📌 예산', go: 'set/budget',
    big: formatKrw(bs.fixedSpent),
    sub: fxExpected > 0 ? ` / 예상 ${formatKrw(fxExpected)}` : '',
    desc: [
      fxExpected > 0 ? (fxRest > 0 ? `아직 안 나간 돈 ${formatKrw(fxRest)}` : '이번 달 고정비는 다 나갔어요') : '예산에 📌 고정 분류가 없어요',
      `지난 3달 평균 ${formatKrw(fxAvg)}`
    ]
  });

  /* ③④ 이체 — 순입금(출금은 빼고)으로 센다. 예상·목표는 설정 › 적립의 대상별 월 기댓값 */
  const trGoals = state.transferGoals || {};
  const trBox = (pick) => {
    const cur = curM.filter(pick).reduce((a, r) => a + r.amount, 0);
    const avg = avg3(pick, r => r.amount);
    const dests = [...new Set(ledger.filter(pick).map(r => r.item || r.minor || '기타'))];
    const goal = dests.reduce((a, k) => a + (Number(trGoals[k]) || 0), 0);
    return { cur, avg, goal, plan: goal || Math.max(avg, 0), fromAvg: !goal };
  };

  const inv = trBox(isInvTr);
  const invRest = inv.plan - inv.cur;
  const box3 = hmStatBox({
    title: '이번 달 투자 이체금', note: '적립', go: 'set/saving',
    big: hmSigned(inv.cur), bigTone: inv.cur < 0 ? 'out' : '',
    sub: inv.plan > 0 ? ` / 예상 ${formatKrw(inv.plan)}` : '',
    desc: [
      inv.plan > 0 ? (invRest > 0 ? `앞으로 보낼 돈 ${formatKrw(invRest)}` : '이번 달 몫은 다 보냈어요')
        + (inv.fromAvg ? ' (예상 = 3달 평균)' : '') : '',
      `지난 3달 평균 ${hmSigned(inv.avg)}`
    ]
  });

  const emg = trBox(isEmgTr);
  const emgPct = emg.plan > 0 ? (Math.max(emg.cur, 0) / emg.plan) * 100 : 0;
  const box4 = hmStatBox({
    title: '이번 달 비상금 이체금', note: '적립', go: 'set/saving',
    big: hmSigned(emg.cur), bigTone: emg.cur < 0 ? 'out' : '',
    sub: emg.plan > 0 ? ` / ${emg.fromAvg ? '예상' : '목표'} ${formatKrw(emg.plan)}` : '',
    desc: [
      emg.plan > 0
        ? (emg.cur < 0 ? `이번 달은 ${formatKrw(-emg.cur)} 꺼내 썼어요`
          : emg.cur >= emg.plan ? '이번 달 목표 채웠어요' : `목표까지 ${formatKrw(emg.plan - emg.cur)}`)
          + (emg.fromAvg ? ' (목표 = 3달 평균)' : '')
        : '적립 목표를 아직 안 정했어요',
      `지난 3달 평균 ${hmSigned(emg.avg)}`
    ],
    gauge: emg.plan > 0 ? hmGauge(emgPct, 'emg', '목표', null) : ''
  });

  /* ── 층 1 · 순자산 — 마지막 자산 스냅샷 기준. 다음 목표 = 지금보다 큰 다음 1억 단위 ── */
  const debt = totalDebt();
  const netWorth = (d.totalAssets || 0) - debt;
  const nwGoal = Math.max(1, Math.floor(netWorth / 1e8) + 1) * 1e8;
  const nwPct = netWorth > 0 ? (netWorth / nwGoal) * 100 : 0;
  const snapLabel = d.latestMonth ? assetMonthLabel(d.latestMonth) : '';
  const boxNw = hmStatBox({
    title: '순자산', note: snapLabel ? `${snapLabel} 스냅샷` : '스냅샷', go: 'entry/snapshot', cls: 'hm-key',
    big: d.totalAssets ? formatKrw(netWorth) : '—',
    sub: d.totalAssets ? ` / 다음 목표 ${formatKrw(nwGoal)}` : '',
    desc: [
      d.deltaAssets != null ? `전월 대비 <b class="${d.deltaAssets >= 0 ? 'in' : 'out'}">${d.deltaAssets >= 0 ? '+' : '−'}${formatKrw(Math.abs(d.deltaAssets))}</b>${d.deltaPct == null ? '' : ` (${d.deltaPct >= 0 ? '+' : ''}${d.deltaPct.toFixed(1)}%)`}` : '',
      d.totalAssets ? `목표까지 ${formatKrw(Math.max(nwGoal - netWorth, 0))}${debt ? ` · 부채 ${formatKrw(debt)} 뺀 값` : ''}` : '자산 스냅샷을 아직 안 적었어요',
      '<i>월 1회 · 이거 하나만 머리에 넣기</i>'
    ],
    gauge: d.totalAssets ? hmGauge(nwPct, 'nw', '목표', null) : ''
  });

  /* ── 층 2 · 월 저축률 — 끝난 달(지난달)을 크게, 진행 중인 이번 달은 참고로 ── */
  const rateOf = (k) => {
    const rows = ledger.filter(r => ledgerMonthKey(r.date) === k);
    const inc = rows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0);
    const out = rows.filter(isExpense).reduce((a, r) => a + netExpenseOf(r), 0);
    return inc > 0 ? ((inc - out) / inc) * 100 : null;
  };
  const lastK = prev[prev.length - 1];
  const rLast = rateOf(lastK);
  const rNow = rateOf(mk);
  const rList = prev.map(rateOf).filter(v => v !== null);
  const rAvg = rList.length ? rList.reduce((a, b) => a + b, 0) / rList.length : null;
  const rTarget = Number(state.goals.savingsRateTarget) || 0;
  const pct1 = (v) => v === null ? '—' : v.toFixed(0) + '%';
  const boxRate = hmStatBox({
    title: '월 저축률', note: `${Number(lastK.split('-')[1])}월 기준`, go: 'report/monthly',
    big: pct1(rLast), bigTone: rLast !== null && rLast < 0 ? 'out' : '',
    sub: rTarget ? ` / 목표 ${rTarget}%` : '',
    desc: [
      `이번 달(진행 중) ${pct1(rNow)} · 지난 3달 평균 ${pct1(rAvg)}`,
      '<i>월 1회</i>'
    ],
    gauge: rTarget && rLast !== null ? hmGauge(Math.max(rLast, 0) / rTarget * 100, rLast >= rTarget ? 'good' : 'nw', '목표', null) : ''
  });

  /* ── 층 3 · 자산 배분 — 현금(현금·저축) / 주식(투자) / 연금 / 그 밖 ── */
  const al = d.allocation || {};
  const alTot = Object.values(al).reduce((a, v) => a + Math.max(v, 0), 0);
  const known = ['현금 자산', '저축 자산', '투자 자산', '연금 자산'];
  const segs = [
    { k: 'cash', name: '현금', v: (al['현금 자산'] || 0) + (al['저축 자산'] || 0) },
    { k: 'stock', name: '주식', v: al['투자 자산'] || 0 },
    { k: 'pen', name: '연금', v: al['연금 자산'] || 0 },
    { k: 'etc', name: '기타', v: Object.entries(al).filter(([c]) => !known.includes(c)).reduce((a, [, v]) => a + v, 0) }
  ].filter(x => x.v > 0).map(x => ({ ...x, p: alTot ? (x.v / alTot) * 100 : 0 }));
  const top = segs.slice().sort((a, b) => b.p - a.p)[0];
  const boxAlloc = hmStatBox({
    title: '자산 배분', note: '순자산 화면', go: 'report/networth',
    big: top ? `<span class="hm-dot big a-${top.k}"></span>${top.name} ${top.p.toFixed(0)}%` : '—',
    desc: [
      segs.filter(x => x !== top).map(x => `<span class="hm-dot a-${x.k}"></span>${x.name} ${x.p.toFixed(0)}%`).join(' · '),
      '<i>분기 1회</i>'
    ],
    extra: segs.length ? `<div class="hm-alloc">${segs.map(x =>
      `<i class="a-${x.k}" style="width:${x.p.toFixed(2)}%" title="${x.name} ${formatKrw(x.v)}"></i>`).join('')}</div>` : ''
  });

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
      <div class="hm-row hm-row3">${boxNw}${boxRate}${boxAlloc}</div>
      <div class="hm-row hm-row2">${box1}${box2}</div>
      <div class="hm-row hm-row2">${box3}${box4}</div>
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
     { 분류: { amount, memo, fixed?, items: { 세부분류: { amount, memo, fixed? } } } }
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
    if (v.fixed) g.fixed = true;
    Object.entries(v.items || {}).forEach(([n, x]) => {
      const o = (x && typeof x === 'object') ? x : { amount: x };
      g.items[n] = { amount: Number(o.amount) || 0, memo: o.memo || '' };
      if (o.fixed) g.items[n].fixed = true;
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

/* ---------------- 고정 예산 ----------------
   말랑한 통장·주거·구독처럼 달이 시작하면 이미 정해진 돈은 📌(fixed) 로 표시한다.
   분류에 📌 → 그 분류 전체가 고정, 세부분류에 📌 → 그 세부분류만 고정.
   홈의 '남은 예산'은 고정을 뺀 변동 예산 − 변동 지출이라, 월초에 고정비가 나가도 줄지 않는다. */
function budgetLineFixed(c, i, map) {
  const g = (map || state.budgets || {})[c];
  if (!g) return false;
  if (g.fixed) return true;
  const it = i && g.items && g.items[i];
  return !!(it && it.fixed);
}
/* 기록 한 줄이 고정비인가 — 지출이고, 그 분류·세부분류가 예산에서 📌 인 것.
   (예전엔 사용처·기록마다 📌 를 따로 켰다. 2026-09-30 부터 예산 분류 하나로 통일, DB is_fixed 는 안 읽는다) */
function txFixed(kind, cat, sub) {
  return String(kind || '').includes('지출') && budgetLineFixed(cat || '기타', sub || '기타');
}
function budgetFixedTotal(map) {
  let t = 0;
  Object.values(map || state.budgets || {}).forEach(g => {
    if (g.fixed) { t += budgetCatAmount(g); return; }
    Object.values(g.items || {}).forEach(x => { if (x.fixed) t += Number(x.amount) || 0; });
  });
  return t;
}
/* 이번 달 예산을 고정·변동으로 나눈다. rows = 이번 달 지출 기록.
   예산을 안 적었으면(평균으로 대신하는 경우) 고정 구분 없이 전부 변동으로 본다. */
function budgetSplit(data, rows) {
  const total = budgetPaceMonthly(data);
  const has = budgetMonthlyTotal() > 0;
  const fixedBudget = has ? budgetFixedTotal() : 0;
  let fixedSpent = 0, varSpent = 0;
  rows.forEach(r => {
    const v = netExpenseOf(r);
    if (has && budgetLineFixed(r.minor || '기타', r.item || '기타')) fixedSpent += v; else varSpent += v;
  });
  const varBudget = total - fixedBudget;
  return { total, has, fixedBudget, fixedSpent, varBudget, varSpent,
           left: varBudget - varSpent, spent: fixedSpent + varSpent };
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
  /* 3) 이번 달 자산 스냅샷(계좌 잔액)을 아직 안 적었다 — 1일부터 적을 때까지 */
  if (snapNeedsInput(data)) out.push({ text: `${now.getMonth() + 1}월 자산 스냅샷 입력하기`, go: 'entry/snapshot' });
  /* 4) 토스 수집이 하루 넘게 멈췄다 */
  const s = data.toss && data.toss.summary;
  if (s) {
    const f = tossFreshness(s.asOf);
    if (f.mins != null && f.mins > 24 * 60) out.push({ text: `토스 수집 멈춤 (${f.text})`, go: 'invest/book' });
  }
  return out;
}
