/* ================= 투자 — 요약 · 화면 전환 ================= */

const INV_VIEWS = {
  ovGrowth:     { label: '자산 성장률', note: '넣은 돈 대비 몇 % 불었나' },
  ovTransfer:   { label: '투자 이체',   note: '원금이 쌓여온 과정' },
  ovRealized:   { label: '실현 수익',   note: '확정된 수익 — 판매수익 + 배당' },
  ovUnrealized: { label: '평가손익',    note: '평가액과 원금의 간격 = 미실현 손익' }
};

const INV_SUBS = [
  ['overview', '요약'],
  ['book', '종목'],
  ['rules', '매매원칙']
];

/* 투자 요약: 예전 4개 화면(성장률·이체·실현·평가손익)은 같은 차트의 다른 보기일 뿐이라
   한 화면으로 합치고 차트 머리의 보기 버튼으로 고른다. */
function renderInvestmentPage(container, data, d) {
  if (INV_VIEWS[state.invSub]) { state.invView = state.invSub; state.invSub = 'overview'; }
  const SUB = INV_SUBS.some(s => s[0] === state.invSub) ? state.invSub : 'overview';
  const VKEY = SUB === 'overview' ? (INV_VIEWS[state.invView] ? state.invView : 'ovGrowth') : null;
  const VIEW = VKEY ? INV_VIEWS[VKEY] : null;
  if (VIEW && !state.invSeriesBySub[VKEY]) state.invSeriesBySub[VKEY] = { ...state.invSeries };
  const SER = VIEW ? state.invSeriesBySub[VKEY] : state.invSeries;
  const subnav = '';
  const invCategories = ['투자 자산'];
  const byMonthCat = {};
  data.assetRows.forEach(r => {
    if (!invCategories.includes(r.category) || r.amount === null) return;
    byMonthCat[r.date] = byMonthCat[r.date] || {};
    byMonthCat[r.date]['투자 자산'] = (byMonthCat[r.date]['투자 자산'] || 0) + r.amount;
  });
  const months = d.assetMonths;
  const latestMonth = d.latestMonth;
  const latestInv = (byMonthCat[latestMonth] && byMonthCat[latestMonth]['투자 자산']) || 0;

  const latestTransferIdx = d.latestPivotIdx;
  const investTransfer = (data.transferCategories['투자 자산'] || [])[latestTransferIdx] || 0;

  const transferSeries = data.transferCategories['투자 자산'] || [];
  let cum = 0;
  const cumByPivotKey = {};
  data.months.forEach((m, i) => { cum += transferSeries[i] || 0; cumByPivotKey[pivotMonthKey(m)] = cum; });
  const cumSeries = months.map(am => {
    const k = assetMonthKey(am);
    let val = cumByPivotKey[k];
    if (val === undefined) {
      const keys = Object.keys(cumByPivotKey).map(Number).filter(pk => pk <= k).sort((a, b) => b - a);
      val = keys.length ? cumByPivotKey[keys[0]] : 0;
    }
    return { month: am, cumContribution: val, balance: (byMonthCat[am] && byMonthCat[am]['투자 자산']) || 0 };
  });
  const latestGain = cumSeries.length ? cumSeries[cumSeries.length - 1].balance - cumSeries[cumSeries.length - 1].cumContribution : 0;

  /* 납입 원금(순 이체 누적) 대비 현재 평가액 — 자산 스냅샷 최신월 기준으로 두 값을 맞춘다 */
  const latestCumContrib = cumSeries.length ? cumSeries[cumSeries.length - 1].cumContribution : cum;
  const latestBalance = cumSeries.length ? cumSeries[cumSeries.length - 1].balance : latestInv;
  const roiPct = latestCumContrib > 0 ? (latestGain / latestCumContrib) * 100 : null;
  const valueRatioPct = latestCumContrib > 0 ? (latestBalance / latestCumContrib) * 100 : null;
  /* 월별 수익률 추이 (평가액 / 누적 원금 − 1) */
  const roiSeries = cumSeries.map(s => ({
    month: s.month,
    roi: s.cumContribution > 0 ? ((s.balance - s.cumContribution) / s.cumContribution) * 100 : null
  }));
  const fmtPct = (v) => (v === null || v === undefined || isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);

  const accounts = {};
  data.assetRows.filter(r => r.date === latestMonth && invCategories.includes(r.category)).forEach(r => {
    accounts[r.account] = { amount: r.amount, category: r.category };
  });
  const accountList = Object.entries(accounts).sort((a, b) => b[1].amount - a[1].amount);
  const investLedger = data.ledger.filter(r => r.minor === '투자 자산' || r.minor === '투자 수익');

  const hasTags = data.investmentTags && data.investmentTags.length > 0;
  const stockProfit = hasTags
    ? (() => { const m = {}; data.investmentTags.forEach(r => { m[r.stock] = (m[r.stock] || 0) + r.total; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); })()
    : getStockProfit(data.ledger);
  const stockProfitFiltered = stockProfit.filter(([, v]) => v !== 0).slice(0, 30);
  const tagAgg = hasTags ? aggregateByTag(data.investmentTags) : [];


  const stockCategoryMap = data.stockCategoryMap || {};
  /* 한 종목이 '우주, 레버리지'처럼 여러 테마를 가지면 각 테마에 모두 집계한다(합계는 중복). */
  const stockTags = (name) => String(stockCategoryMap[name] || '').split(',').map(x => x.trim()).filter(Boolean);
  const stockCatAgg = (() => {
    const m = {};
    stockProfit.forEach(([name, amt]) => {
      const tags = stockTags(name);
      if (!tags.length) { m['미분류'] = (m['미분류'] || 0) + amt; return; }
      tags.forEach(t => { m[t] = (m[t] || 0) + amt; });
    });
    return Object.entries(m).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  })();

  const returnsDataFull0 = getInvestmentIncomeMonthly(data.ledger);
  let cumInvestmentIncome = 0;
  returnsDataFull0.months.forEach(m => {
    returnsDataFull0.items.forEach(it => {
      cumInvestmentIncome += (returnsDataFull0.byMonthItem[m] && returnsDataFull0.byMonthItem[m][it]) || 0;
    });
  });

  container.innerHTML = subnav + `
    ${VIEW ? `
    <div class="g">
      <div class="stat-grid s12" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:0;">
        <div class="stat-card">
          <div class="label">평가액</div>
          <div class="value">${formatCompactWon(latestInv)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">누적 원금</div>
          <div class="value">${formatCompactWon(latestCumContrib)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">평가손익</div>
          <div class="value" style="color:${latestGain >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">${latestGain >= 0 ? '+' : ''}${formatCompactWon(latestGain)}원<span class="v-note">(원금 대비 ${roiPct === null ? '—' : fmtPct(roiPct)})</span></div>
        </div>
        <div class="stat-card">
          <div class="label">누적 실현수익</div>
          <div class="value" style="color:${cumInvestmentIncome >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">${cumInvestmentIncome >= 0 ? '+' : ''}${formatCompactWon(cumInvestmentIncome)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">총자산 대비 비중</div>
          <div class="value">${d.totalAssets ? (latestInv / d.totalAssets * 100).toFixed(0) : '—'}%</div>
        </div>
      </div>
    </div>

    <div class="g">
      <div class="panel s12">
        <div class="panel-title">
          <div class="inv-viewhd">
            <div class="range-toggle inv-views" id="inv-view-toggle">${Object.entries(INV_VIEWS).map(([k, v]) =>
              `<button data-view="${k}" class="${k === VKEY ? 'active' : ''}">${v.label}</button>`).join('')}</div>
            <span class="inv-viewnote">${VIEW ? VIEW.note : ''}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <div class="range-toggle" id="inv-period-toggle">
              <button data-period="month" class="${(state.invPeriod || 'month') === 'month' ? 'active' : ''}">월</button>
              <button data-period="year" class="${state.invPeriod === 'year' ? 'active' : ''}">연</button>
            </div>
            <div class="range-toggle" id="inv-range-toggle"></div>
          </div>
        </div>
        <div class="series-toggles" id="inv-series-toggles">
          ${INV_SERIES.map(sr => `<label class="series-chk ${SER[sr.key] ? 'on' : ''}">
            <input type="checkbox" data-key="${sr.key}" ${SER[sr.key] ? 'checked' : ''} />
            <i style="background:${sr.color}"></i>${sr.label}
          </label>`).join('')}
        </div>
        <div class="chart-wrap tall" style="min-height:300px;"><canvas id="chart-inv-main"></canvas></div>
      </div>
    </div>` : ''}

    ${SUB === 'book' ? `<div id="panel-book"></div>` : ''}

    ${SUB === 'rules' ? `<div id="panel-rules"></div>` : ''}

  `;

  if (SUB === 'book') renderBookPage('panel-book', data, d);
  if (SUB === 'rules') renderRulesPage('panel-rules');

  const vt = document.getElementById('inv-view-toggle');
  if (vt) vt.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => {
    state.invView = b.dataset.view;
    renderPage();
  }));

  if (VIEW) {

  const returnsDataFull = getInvestmentIncomeMonthly(data.ledger);
  /* --- 통합 추이 차트 --- */
  const amToYM = (am) => {
    const pk = assetMonthToPivotKey(am);
    if (!pk) return null;
    const ym = pivotYearMonth(pk);
    return ym.year ? `${ym.year}-${String(ym.month).padStart(2, '0')}` : null;
  };
  const transferByYM = {};
  data.months.forEach((pm, i) => {
    const ym = pivotYearMonth(pm);
    if (!ym.year) return;
    transferByYM[`${ym.year}-${String(ym.month).padStart(2, '0')}`] = (data.transferCategories['투자 자산'] || [])[i] || 0;
  });
  const returnsByYM = {};
  Object.keys(returnsDataFull.byMonthItem).forEach(k => {
    returnsByYM[k] = Object.values(returnsDataFull.byMonthItem[k]).reduce((a, v) => a + v, 0);
  });
  /* 누적 실현수익은 흐름이 아니라 잔액성이다 — 연 단위로 볼 때도 그 해 합이 아니라
     그 시점까지의 누적을 집어야 한다. 그래서 flowAgg 가 아니라 별도 조회를 쓴다. */
  const cumReturnsByYM = {};
  (() => {
    let acc = 0;
    Object.keys(returnsByYM).sort().forEach(k => { acc += returnsByYM[k]; cumReturnsByYM[k] = acc; });
  })();
  const cumReturnsKeys = Object.keys(cumReturnsByYM).sort();
  const cumReturnsAt = (am) => {
    const ym = amToYM(am);
    if (!ym) return null;
    if (cumReturnsByYM[ym] !== undefined) return cumReturnsByYM[ym];
    let v = 0;
    for (let i = 0; i < cumReturnsKeys.length; i++) {
      if (cumReturnsKeys[i] <= ym) v = cumReturnsByYM[cumReturnsKeys[i]]; else break;
    }
    return v;
  };

  const drawInvMain = () => {
    const ctx = document.getElementById('chart-inv-main');
    if (!ctx) return;
    if (state.charts.invMain) state.charts.invMain.destroy();
    const period = state.invPeriod || 'month';
    const src = period === 'year' ? months : sliceByRange(months, state.invRange);

    let labels, pick;
    if (period === 'year') {
      const byYear = {};
      months.forEach(am => { byYear[assetMonthYear(am)] = am; });   /* 연말 스냅샷 */
      const years = Object.keys(byYear).sort();
      labels = years.map(y => y + '년');
      pick = years.map(y => byYear[y]);
      /* 연 단위 흐름 항목(이체·실현)은 그 해 합계 */
      var flowAgg = (mapByYM) => years.map(y => months.filter(am => assetMonthYear(am) === y)
        .reduce((a, am) => a + ((mapByYM[amToYM(am)] || 0)), 0));
    } else {
      labels = src.map(assetMonthLabel);
      pick = src;
      var flowAgg = (mapByYM) => src.map(am => mapByYM[amToYM(am)] || 0);
    }

    const cumMap = {}; cumSeries.forEach(x => { cumMap[x.month] = x; });
    const roiMap = {}; roiSeries.forEach(x => { roiMap[x.month] = x.roi; });

    const S = SER;
    const ds = [];
    if (S.transfer) ds.push({ type: 'bar', label: '투자 이체', data: flowAgg(transferByYM), backgroundColor: 'rgba(57,168,189,0.7)', borderRadius: 3, yAxisID: 'yFlow', labelColor: '#a8e6f0', order: 4 });
    if (S.returns) ds.push({ type: 'bar', label: '실현 수익', data: flowAgg(returnsByYM), backgroundColor: 'rgba(224,138,95,0.85)', borderRadius: 3, yAxisID: 'yFlow', labelColor: '#f0b795', order: 3 });
    if (S.returnsCum) ds.push({ type: 'line', label: '누적 실현수익', data: pick.map(cumReturnsAt), borderColor: '#c56a3a', backgroundColor: 'rgba(197,106,58,0.12)', fill: true, tension: 0.3, pointRadius: 2, spanGaps: true, yAxisID: 'y', labelColor: '#f0b795', labelOffset: -18, order: 2 });
    if (S.balance) ds.push({ type: 'line', label: '평가액', data: pick.map(am => (cumMap[am] ? cumMap[am].balance : 0)), borderColor: '#4c8c6b', backgroundColor: 'rgba(76,140,107,0.10)', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y', labelColor: '#a8d8bf', labelOffset: -18, order: 1 });
    if (S.contrib) ds.push({ type: 'line', label: '누적 원금', data: pick.map(am => (cumMap[am] ? cumMap[am].cumContribution : 0)), borderColor: '#e0c766', borderDash: [5, 4], backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, yAxisID: 'y', labelColor: '#efdfa0', labelOffset: 16, order: 2 });
    if (S.roi) ds.push({ type: 'line', label: '원금 대비 수익률', data: pick.map(am => (roiMap[am] === undefined ? null : roiMap[am])), borderColor: '#9b7fc2', backgroundColor: 'transparent', borderDash: [3, 3], tension: 0.3, pointRadius: 0, spanGaps: true, yAxisID: 'yRoi', order: 0,
      labelColor: '#c0a8e0', labelOffset: -14, labelFormatter: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%` });
    if (S.share) ds.push({ type: 'line', label: '총자산 대비 비중', data: pick.map(am => {
      const tot = d.byMonth[am] || 0;
      const bal = cumMap[am] ? cumMap[am].balance : 0;
      return tot > 0 ? +((bal / tot) * 100).toFixed(1) : null;
    }), borderColor: '#5b8fc7', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 1.6, spanGaps: true, yAxisID: 'yRoi', order: 0,
      labelColor: '#9dc2e8', labelOffset: 14, labelFormatter: (v) => `${v.toFixed(0)}%` });

    state.charts.invMain = new Chart(ctx, {
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 28 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.dataset.yAxisID === 'yRoi' ? (c.raw === null ? '—' : (c.dataset.label === '총자산 대비 비중' ? c.raw + '%' : fmtPct(c.raw))) : formatWon(c.raw)}` } }
        },
        scales: {
          x: { ticks: { ...MONO_TICK, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
          /* 좌축 = 잔액성(평가액·원금), 우축 = 흐름성(이체·실현수익) — 자릿수가 달라 축을 나눈다 */
          y: { display: !!(S.balance || S.contrib || S.returnsCum), position: 'left', ticks: { ...MONO_TICK, color: '#7fc0a0', callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT, title: { display: true, text: '잔액', color: '#7fc0a0', font: { family: 'IBM Plex Mono', size: 9 } } },
          yFlow: { display: S.transfer || S.returns, position: 'right', beginAtZero: true, ticks: { ...MONO_TICK, color: '#e0c766', callback: (v) => formatCompactWon(v) }, grid: { display: false }, title: { display: true, text: '월/연 흐름', color: '#e0c766', font: { family: 'IBM Plex Mono', size: 9 } } },
          yRoi: { display: !!(S.roi || S.share), position: 'right', ticks: { ...MONO_TICK, color: '#c0a8e0', callback: (v) => `${v}%` }, grid: { display: false } }
        }
      },
      plugins: [valueLabelPlugin]
    });
  };
  drawInvMain();

  function onInvRangePick(v) {
    state.invRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('inv-range-toggle', RANGE_OPTIONS, state.invRange, onInvRangePick);
    drawInvMain();
  }
  bindRangeToggle('inv-range-toggle', RANGE_OPTIONS, state.invRange, onInvRangePick);
  document.getElementById('inv-period-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.invPeriod = btn.dataset.period;
    document.querySelectorAll('#inv-period-toggle button').forEach(b => b.classList.toggle('active', b === btn));
    drawInvMain();
  });
  document.getElementById('inv-series-toggles').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    SER[cb.dataset.key] = cb.checked;
    cb.closest('.series-chk').classList.toggle('on', cb.checked);
    drawInvMain();
  });
  }

}


