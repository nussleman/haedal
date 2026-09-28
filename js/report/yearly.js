/* ---------------- page: 올해 ---------------- */

const YEAR_OPTS = [
  { key: 'budget', label: '예산 페이스', color: '#c9a227' },
  { key: 'prevYear', label: '작년 같은 시점', color: '#9aa3b6' }
];

function renderYearPage(container, data, d) {
  const rows = data.months.map((m, i) => {
    const ym = pivotYearMonth(m);
    return { key: m, year: ym.year, month: ym.month, income: data.incomeTotal[i] || 0, expense: data.expenseTotal[i] || 0 };
  }).filter(r => r.year);

  const years = [...new Set(rows.map(r => r.year))].sort();
  if (!state.yearKey || !years.includes(state.yearKey)) {
    const t = String(new Date().getFullYear());
    state.yearKey = years.includes(t) ? t : years[years.length - 1];
  }
  const Y = state.yearKey;
  const prevY = String(Number(Y) - 1);
  const isThisYear = Y === String(new Date().getFullYear());

  const YR_SUBS = [['summary', '요약'], ['income', '수입'], ['expense', '지출'], ['saving', '순저축'], ['invest', '투자']];
  const YR_TOP_PCT = 3;   /* 주요 사용처/수익처 노출 기준 = 연 합계의 3% 이상 */
  if (state.yearSub === 'detail') state.yearSub = 'expense';
  const YSUB = YR_SUBS.some(x => x[0] === state.yearSub) ? state.yearSub : 'summary';
  const YMODE = (state.yearMode === 'flow') ? 'flow' : 'pace';
  const cur = rows.filter(r => r.year === Y).sort((a, b) => a.month - b.month);
  const lastMonthWithData = cur.reduce((a, r) => (r.income > 0 || r.expense > 0) ? r.month : a, 0);
  const throughMonth = isThisYear ? Math.max(new Date().getMonth() + 1, lastMonthWithData) : 12;
  const prev = rows.filter(r => r.year === prevY);
  const prevSame = prev.filter(r => r.month <= throughMonth);

  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const income = sum(cur, 'income'), expense = sum(cur, 'expense');
  const net = income - expense;
  const rate = income > 0 ? (net / income) * 100 : null;

  const pIncome = sum(prevSame, 'income'), pExpense = sum(prevSame, 'expense');
  const pNet = pIncome - pExpense;
  const pRate = pIncome > 0 ? (pNet / pIncome) * 100 : null;
  const cmpNote = isThisYear ? `${prevY}년 1–${throughMonth}월 대비` : `${prevY}년 대비`;

  const monthsElapsed = cur.filter(r => r.income > 0 || r.expense > 0).length || throughMonth;
  const projected = isThisYear && monthsElapsed > 0 ? { income: income / monthsElapsed * 12, expense: expense / monthsElapsed * 12 } : null;

  /* 주요 수입 · 지출 TOP (가계부 원장 기준, 항목+사용처로 묶음) */
  const yrRows = (data.ledger || []).filter(r => String(ledgerMonthKey(r.date) || '').startsWith(Y));
  const topOf = (pred, useNet) => {
    const m = {};
    yrRows.filter(pred).forEach(r => {
      const nm = [r.minor, r.item].filter(Boolean).join(' · ') || r.vendor || '기타';
      if (!m[nm]) m[nm] = { name: nm, v: 0, n: 0 };
      m[nm].v += useNet ? netExpenseOf(r) : r.amount;
      m[nm].n += 1;
    });
    return Object.values(m).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
  };
  /* 이체 (투자원금 · 비상금) — 올해 vs 작년 같은 시점 */
  const trSum = (rows, kw) => rows.filter(r => r.major.includes('이체') && String(r.minor || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
  const prevYrRowsSame = (data.ledger || []).filter(r => {
    const mk = ledgerMonthKey(r.date) || '';
    if (!mk.startsWith(prevY)) return false;
    return Number(mk.slice(5)) <= throughMonth;
  });
  const yrInvestTr = trSum(yrRows, '투자');
  const yrEmgTr = trSum(yrRows, '비상금');
  const pInvestTr = trSum(prevYrRowsSame, '투자');
  const pEmgTr = trSum(prevYrRowsSame, '비상금');

  const topIncome = topOf(r => r.major.includes('수입'), false);
  const topExpense = topOf(r => r.major.includes('지출'), true);
  const maxTopIn = Math.max(...topIncome.map(r => r.v), 1);
  const maxTopEx = Math.max(...topExpense.map(r => r.v), 1);

  container.innerHTML = `
    <div class="page-daybar">
      <div class="today-datewrap">
        <div class="day-title">${Y}년</div>
        <div class="month-nav">
          <button id="yr-prev" ${years.indexOf(Y) <= 0 ? 'disabled' : ''}>◀</button>
          <select id="yr-select">${years.slice().reverse().map(y => `<option value="${y}" ${y === Y ? 'selected' : ''}>${y}년</option>`).join('')}</select>
          <button id="yr-next" ${years.indexOf(Y) >= years.length - 1 ? 'disabled' : ''}>▶</button>
        </div>
      </div>
    </div>

    <div class="subnav sub2" id="yr-subnav">${YR_SUBS.map(([v, l]) =>
      `<button data-sub="${v}" class="${v === YSUB ? 'active' : ''}">${l}</button>`).join('')}</div>

    ${YSUB === 'summary' ? `
    <div class="stat-grid" style="margin-bottom:0;">
        <div class="stat-card clickable" data-goto="income" title="수입 탭으로 이동">
          <div class="label">수입</div>
          <div class="value" style="color:var(--income-text)">${formatKrw(income)}</div>
          ${cmpSub(income, pIncome, false, cmpNote)}
          ${projected ? `<div class="sub">연말 예상 ${formatCompactWon(projected.income)}원</div>` : ''}
        </div>
        <div class="stat-card clickable" data-goto="expense" title="지출 탭으로 이동">
          <div class="label">지출</div>
          <div class="value" style="color:var(--expense-text)">${formatKrw(expense)}</div>
          ${cmpSub(expense, pExpense, true, cmpNote)}
          ${projected ? `<div class="sub">연말 예상 ${formatCompactWon(projected.expense)}원</div>` : ''}
        </div>
        <div class="stat-card clickable" data-goto="saving" title="순저축 탭으로 이동">
          <div class="label">순익 (쌓인 돈)</div>
          <div class="value" style="color:${net >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatKrw(net)}</div>
          ${cmpSub(net, pNet, false, cmpNote)}
          <div class="sub">월 평균 ${formatCompactWon(monthsElapsed ? net / monthsElapsed : 0)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">저축률</div>
          <div class="value" style="color:${rate !== null && rate >= state.goals.savingsRateTarget ? 'var(--net-text)' : 'var(--expense-text)'}">${rate === null ? '—' : rate.toFixed(1) + '%'}</div>
          ${cmpSubPp(rate, state.goals.savingsRateTarget, `목표 ${state.goals.savingsRateTarget}% 대비`)}
          ${cmpSubPp(rate, pRate, `${prevY}년 대비`)}
        </div>
        <div class="stat-card clickable" data-goto="invest" title="투자 탭으로 이동">
          <div class="label">투자원금 이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatKrw(yrInvestTr)}</div>
          ${cmpSub(yrInvestTr, pInvestTr, false, cmpNote)}
          ${income > 0 ? `<div class="sub">수입의 <b>${((yrInvestTr / income) * 100).toFixed(1)}%</b> · 월 평균 ${formatCompactWon(monthsElapsed ? yrInvestTr / monthsElapsed : 0)}원</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="label">비상금 이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatKrw(yrEmgTr)}</div>
          ${cmpSub(yrEmgTr, pEmgTr, false, cmpNote)}
          ${income > 0 ? `<div class="sub">수입의 <b>${((yrEmgTr / income) * 100).toFixed(1)}%</b></div>` : ''}
        </div>
    </div>

    <div class="g">
      <div class="panel s12">
        <div class="panel-title">
          <div>${YMODE === 'pace' ? '페이스 차트' : '흐름 차트'}<span class="pace-tag" id="yr-pace-tag"></span></div>
          <div class="range-toggle" id="yr-mode">
            <button data-m="pace" class="${YMODE === 'pace' ? 'active' : ''}">페이스</button>
            <button data-m="flow" class="${YMODE === 'flow' ? 'active' : ''}">월별</button>
          </div>
        </div>
        ${YMODE === 'pace' ? `<div class="axis-bar">
          <div class="axis-btns" id="yr-axis-btns">
            ${FLOW_AXES.map(a => `<button data-axis="${a.key}" class="axis-btn ${state.yearAxis === a.key ? 'on' : ''}" style="--ac:${a.color}">
              <i></i>${a.label}
            </button>`).join('')}
          </div>
          <div class="series-toggles" id="yr-series-toggles" style="margin-bottom:0;">
            ${YEAR_OPTS.filter(sr => sr.key !== 'budget' || state.yearAxis === 'expense').map(sr => `<label class="series-chk ${state.yearOpts[sr.key] ? 'on' : ''}">
              <input type="checkbox" data-key="${sr.key}" ${state.yearOpts[sr.key] ? 'checked' : ''} />
              <i style="background:${sr.color}"></i>${sr.label}
            </label>`).join('')}
          </div>
        </div>` : ''}
        <div class="chart-wrap tall"><canvas id="chart-year"></canvas></div>
        <div class="chart-legend" id="yr-legend"></div>
      </div>
    </div>` : ''}

    ${YSUB !== 'summary' ? `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(146px,1fr));margin-bottom:12px;" id="yr-sub-stats"></div>
    <div class="g">
      <div class="panel ${YSUB === 'income' ? 's8' : 's12'}">
        <div class="panel-title"><div>${YSUB === 'invest' ? '월별 평가액' : '월별 추이'}</div><span class="ptag">${Y}년 1–12월</span></div>
        <div class="chart-wrap tall"><canvas id="chart-yr-sub"></canvas></div>
        <div class="chart-legend" id="yr-sub-legend"></div>
      </div>
      ${YSUB === 'income' ? `
      <div class="panel s4">
        <div class="panel-title"><div>수입처 비중</div><span class="ptag">${Y}년</span></div>
        <div class="chart-wrap" style="min-height:230px;"><canvas id="chart-yr-pie"></canvas></div>
      </div>` : ''}
    </div>
    ${YSUB !== 'saving' ? `
    <div class="g">
      <div class="panel s12" id="yr-topsrc-panel">
        <div class="panel-title">
          <div>${YSUB === 'income' ? '주요 수입 사용처' : YSUB === 'expense' ? '주요 지출처' : '주요 수익처'}</div>
          <span class="ptag">${Y}년 · 합계의 ${YR_TOP_PCT}% 이상</span>
        </div>
        <div id="yr-topsrc-body"></div>
      </div>
    </div>` : ''}` : ''}
  `;

  document.getElementById('yr-subnav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.yearSub = b.dataset.sub;
    renderPage();
  });

  container.querySelectorAll('.stat-card[data-goto]').forEach(el => el.addEventListener('click', () => {
    state.yearSub = el.dataset.goto;
    renderPage();
  }));

  if (YSUB !== 'summary') { renderYearSubTab(YSUB, Y, data, d, yrRows, YR_TOP_PCT); }

  const drawYear = () => {
    if (state.charts.year) state.charts.year.destroy();
    const mode = YMODE;
    const labels = [];
    for (let i = 1; i <= 12; i++) labels.push(i + '월');
    const get = (arr, mo, k) => { const r = arr.find(x => x.month === mo); return r ? r[k] : 0; };
    const has = (mo) => cur.some(x => x.month === mo && (x.income > 0 || x.expense > 0));
    const inc = [], exp = [], nt = [], pnt = [];
    let ci = 0, ce = 0, cp = 0;
    for (let mo = 1; mo <= 12; mo++) {
      const i0 = get(cur, mo, 'income'), e0 = get(cur, mo, 'expense');
      const p0 = get(prev, mo, 'income') - get(prev, mo, 'expense');
      ci += i0; ce += e0; cp += p0;
      const live = has(mo) || !isThisYear;
      inc.push(mode === 'cum' ? (live ? ci : null) : i0);
      exp.push(mode === 'cum' ? (live ? ce : null) : e0);
      nt.push(mode === 'cum' ? (live ? ci - ce : null) : i0 - e0);
      pnt.push(mode === 'cum' ? cp : p0);
    }
    if (mode === 'pace') {
      const budgetTotal = budgetPaceMonthly(data) * 12;
      let ce2 = 0, cp2 = 0, ci2 = 0, cn2 = 0;
      const curCum = [], prevCum = [], incCum = [], netCum = [], budLine = [];
      let lastLive = 0;
      for (let mo = 1; mo <= 12; mo++) {
        const i0 = get(cur, mo, 'income'), e0 = get(cur, mo, 'expense');
        ce2 += e0; ci2 += i0; cn2 += (i0 - e0);
        cp2 += get(prev, mo, 'expense');
        const live = has(mo) || !isThisYear;
        if (live) lastLive = mo;
        curCum.push(live ? ce2 : null);
        incCum.push(live ? ci2 : null);
        netCum.push(live ? cn2 : null);
        prevCum.push(cp2);
        budLine.push(budgetTotal > 0 ? Math.round(budgetTotal / 12 * mo) : null);
      }

      /* 남은 달은 현재 속도로 연장한 '예상' 점선 */
      const proj = (arr) => {
        if (!isThisYear || lastLive <= 0 || lastLive >= 12) return null;
        const base = arr[lastLive - 1];
        if (base === null || base === undefined) return null;
        const perMonth = base / lastLive;
        return arr.map((_, i) => (i < lastLive - 1 ? null : Math.round(perMonth * (i + 1))));
      };
      const pE = proj(curCum), pI = proj(incCum), pN = proj(netCum);

      /* 작년 같은 시점 누적 (수입·순저축도) */
      let pi2 = 0, pn2 = 0;
      const prevInc = [], prevNet = [];
      for (let mo = 1; mo <= 12; mo++) {
        const i0 = get(prev, mo, 'income'), e0 = get(prev, mo, 'expense');
        pi2 += i0; pn2 += (i0 - e0);
        prevInc.push(pi2); prevNet.push(pn2);
      }

      const AX = FLOW_AXES.find(a => a.key === state.yearAxis) || FLOW_AXES[1];
      const O = state.yearOpts;
      const SRC = {
        income: { cum: incCum, prev: prevInc, proj: pI, color: '#4c8c6b', label: '수입' },
        expense: { cum: curCum, prev: prevCum, proj: pE, color: '#c1483f', label: '지출' },
        net: { cum: netCum, prev: prevNet, proj: pN, color: '#9b7fc2', label: '순저축' }
      }[AX.key];

      const curV = lastLive > 0 ? SRC.cum[lastLive - 1] : null;
      const baseV = lastLive > 0 ? SRC.prev[lastLive - 1] : null;
      const tag = document.getElementById('yr-pace-tag');
      if (tag) {
        if (curV === null || baseV === null) tag.textContent = '';
        else {
          const dv = curV - baseV;
          const better = AX.key === 'expense' ? dv < 0 : dv > 0;
          const verb = AX.key === 'expense' ? (dv > 0 ? '더 쓰는' : '덜 쓰는')
                     : AX.key === 'income' ? (dv > 0 ? '더 버는' : '덜 버는')
                     : (dv > 0 ? '더 모으는' : '덜 모으는');
          tag.textContent = `${prevY}년 같은 시점보다 ${formatKrw(Math.abs(Math.round(dv)))} ${verb} 페이스`;
          tag.style.color = Math.abs(dv) < 1 ? 'var(--text-dim)' : (better ? 'var(--income-text)' : '#d9884f');
        }
      }

      const dsP = [];
      if (AX.key === 'expense' && O.budget && budgetTotal > 0) {
        dsP.push({ type: 'line', label: '예산 페이스', data: budLine, borderColor: '#c9a227',
          borderDash: [2, 3], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0, order: 6, hideLabel: true });
      }
      if (O.prevYear) {
        dsP.push({ type: 'line', label: `${prevY}년 ${SRC.label}`, data: SRC.prev, borderColor: '#9aa3b6',
          borderDash: [7, 4], backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0, tension: .25, order: 5,
          labelColor: '#9aa3b6', labelStep: 999, labelOffset: 14 });
      }
      if (SRC.proj) {
        dsP.push({ type: 'line', label: `예상 ${SRC.label}`, data: SRC.proj, borderColor: SRC.color,
          borderDash: [4, 4], backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0, tension: .25,
          spanGaps: true, order: 3, labelColor: SRC.color, labelStep: 999, labelOffset: -14 });
      }
      dsP.push({ type: 'line', label: `${Y}년 누적 ${SRC.label}`, data: SRC.cum, borderColor: SRC.color,
        backgroundColor: hexToRgba(SRC.color, .12), fill: true, borderWidth: 2.6, pointRadius: 2, tension: .25,
        spanGaps: false, order: 1, labelColor: SRC.color, labelStep: 2, labelOffset: -14 });
      document.getElementById('yr-legend').innerHTML = dsP.slice().reverse().map(x =>
        `<span><i style="background:${x.borderColor}"></i>${x.label}</span>`).join('');
      state.charts.year = new Chart(document.getElementById('chart-year'), {
        data: { labels, datasets: dsP },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, right: 12 } },
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.raw === null ? null : ` ${c.dataset.label}: ${formatKrw(c.raw)}`) } } },
          scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
        },
        plugins: [valueLabelPlugin]
      });
      return;
    }

    const tag0 = document.getElementById('yr-pace-tag');
    if (tag0) tag0.textContent = '';
    document.getElementById('yr-legend').innerHTML = `
      <span><i style="background:rgba(76,140,107,0.8)"></i>수입</span>
      <span><i style="background:rgba(193,72,63,0.8)"></i>지출</span>
      <span><i style="background:var(--net-fill)"></i>순익</span>
      <span style="color:var(--text-faint)">점선 = ${prevY}년</span>`;
    state.charts.year = new Chart(document.getElementById('chart-year'), {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: '수입', data: inc, backgroundColor: 'rgba(76,140,107,0.75)', borderRadius: 3, labelColor: '#a8d8bf', order: 3 },
          { type: 'bar', label: '지출', data: exp, backgroundColor: 'rgba(193,72,63,0.75)', borderRadius: 3, labelColor: '#f0b8b2', order: 3 },
          { type: 'line', label: '순익', data: nt, borderColor: '#9b7fc2', backgroundColor: 'transparent', tension: 0.25, pointRadius: 2, borderWidth: 2.5, spanGaps: false, labelColor: '#c0a8e0', labelOffset: -14, order: 1 },
          { type: 'line', label: `${prevY}년 순익`, data: pnt, borderColor: 'rgba(154,163,182,.65)', borderDash: [5, 4], backgroundColor: 'transparent', tension: 0.25, pointRadius: 0, borderWidth: 2, hideLabel: true, order: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw === null ? '—' : formatKrw(c.raw)}` } } },
        scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
      },
      plugins: [valueLabelPlugin]
    });
  };

  if (YSUB !== 'summary') {
    const setYear0 = (y) => { state.yearKey = y; renderPage(); };
    document.getElementById('yr-select').addEventListener('change', (e) => setYear0(e.target.value));
    document.getElementById('yr-prev').addEventListener('click', () => { const i = years.indexOf(Y); if (i > 0) setYear0(years[i - 1]); });
    document.getElementById('yr-next').addEventListener('click', () => { const i = years.indexOf(Y); if (i < years.length - 1) setYear0(years[i + 1]); });
    return;
  }

  drawYear();

  const yrToggles = document.getElementById('yr-series-toggles');
  if (yrToggles) yrToggles.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-key]');
    if (!inp) return;
    state.yearOpts[inp.dataset.key] = inp.checked;
    inp.closest('.series-chk').classList.toggle('on', inp.checked);
    drawYear();
  });
  const yrAxisBtns = document.getElementById('yr-axis-btns');
  if (yrAxisBtns) yrAxisBtns.addEventListener('click', (e) => {
    const b = e.target.closest('.axis-btn');
    if (!b || state.yearAxis === b.dataset.axis) return;
    state.yearAxis = b.dataset.axis;
    renderPage();
  });

  document.getElementById('yr-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.yearMode = b.dataset.m;
    renderPage();
  });
  const setYear = (y) => { state.yearKey = y; renderPage(); };
  document.getElementById('yr-select').addEventListener('change', (e) => setYear(e.target.value));
  document.getElementById('yr-prev').addEventListener('click', () => { const i = years.indexOf(Y); if (i > 0) setYear(years[i - 1]); });
  document.getElementById('yr-next').addEventListener('click', () => { const i = years.indexOf(Y); if (i < years.length - 1) setYear(years[i + 1]); });
}


/* ---------------- 올해 하위 탭 (수입 · 지출 · 순저축 · 투자) ----------------
   전부 선택한 연도(1~12월) 스코프. 기간/단위 토글 없이 항상 12개월을 그린다. */

/* 도넛 조각 안에 이름·비중을 직접 그린다 */
const donutLabelPlugin = {
  id: 'donutLabel',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;
    const raw = chart.data.datasets[0].data || [];
    const total = raw.reduce((a, b) => a + (Number(b) || 0), 0);
    if (!total) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    meta.data.forEach((arc, i) => {
      const v = Number(raw[i]) || 0;
      const pct = (v / total) * 100;
      if (pct < 6) return;
      const a = (arc.startAngle + arc.endAngle) / 2;
      const r = (arc.innerRadius + arc.outerRadius) / 2;
      const x = arc.x + Math.cos(a) * r, y = arc.y + Math.sin(a) * r;
      const name = String(chart.data.labels[i] || '');
      ctx.font = '600 10.5px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(12,14,18,0.85)';
      ctx.fillText(name, x + 0.6, y - 5.4);
      ctx.fillText(pct.toFixed(0) + '%', x + 0.6, y + 6.6);
      ctx.fillStyle = '#f4f2ec';
      ctx.fillText(name, x, y - 6);
      ctx.font = '700 11px ui-monospace, monospace';
      ctx.fillText(pct.toFixed(0) + '%', x, y + 6);
    });
    ctx.restore();
  }
};

function yrAssetSeries(assetRows, year, catRe) {
  /* '26년 08월' → { y:'2026', m:8 } */
  const out = Array.from({ length: 12 }, () => null);
  (assetRows || []).forEach(r => {
    const m = String(r.date || '').match(/(\d{2})년\s*(\d{1,2})월/);
    if (!m) return;
    const yy = String(2000 + Number(m[1]));
    if (yy !== year) return;
    if (!catRe.test(String(r.category || ''))) return;
    const mo = Number(m[2]);
    out[mo - 1] = (out[mo - 1] || 0) + (Number(r.amount) || 0);
  });
  return out;
}

function yrStatCard(label, value, subs, color) {
  return `<div class="stat-card">
    <div class="label">${label}</div>
    <div class="value" ${color ? `style="color:${color}"` : ''}>${value}</div>
    ${(subs || []).filter(Boolean).map(x => typeof x === 'string'
      ? (x.trim().startsWith('<div') ? x : `<div class="sub">${x}</div>`)
      : `<div class="sub ${x.tone || ''}">${x.text}</div>`).join('')}
  </div>`;
}

function yrTopSources(rows, valueOf, nameOf, total, pct) {
  const map = {};
  rows.forEach(r => {
    const nm = nameOf(r) || '기타';
    if (!map[nm]) map[nm] = { name: nm, v: 0, n: 0 };
    map[nm].v += valueOf(r);
    map[nm].n += 1;
  });
  const cut = Math.abs(total) * (pct / 100);
  return Object.values(map).filter(x => x.v >= cut && x.v > 0).sort((a, b) => b.v - a.v);
}

function renderYearSubTab(sub, Y, data, d, yrRows, TOP_PCT) {
  const statBox = document.getElementById('yr-sub-stats');
  const topBox = document.getElementById('yr-topsrc-body');
  const ctx = document.getElementById('chart-yr-sub');
  if (!statBox || !ctx) return;
  const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '월');
  const isThisYear = Y === String(new Date().getFullYear());
  const thruMonth = isThisYear ? (new Date().getMonth() + 1) : 12;
  const netOfR = (r) => r.amount - (r.refund || 0);
  const moOf = (r) => { const mk = ledgerMonthKey(r.date) || ''; return Number(mk.slice(5)) || 0; };
  const bucket = (rows, valueOf) => {
    const a = Array.from({ length: 12 }, () => 0);
    rows.forEach(r => { const m = moOf(r); if (m >= 1 && m <= 12) a[m - 1] += valueOf(r); });
    return a;
  };
  const live = (arr) => arr.map((v, i) => (isThisYear && i + 1 > thruMonth) ? null : v);
  const cumOf = (arr) => { let c = 0; return arr.map((v, i) => { if (v === null) return null; c += v; return c; }); };
  const monthsWith = (arr) => arr.filter(v => v !== null && v !== 0).length || thruMonth;
  /* ---- 다른 연도와의 비교 기준 ---- */
  const allLedger = data.ledger || [];
  const yearsAvail = [...new Set(allLedger.map(r => (ledgerMonthKey(r.date) || '').slice(0, 4)).filter(Boolean))].sort();
  const cap = isThisYear ? thruMonth : null;
  const rowsOfYear = (y) => allLedger.filter(r => {
    const mk = ledgerMonthKey(r.date) || '';
    if (mk.slice(0, 4) !== y) return false;
    return cap ? (Number(mk.slice(5)) <= cap) : true;
  });
  const prevY = String(Number(Y) - 1);
  const prevRows = rowsOfYear(prevY);
  const priorYears = yearsAvail.filter(y => Number(y) < Number(Y));
  const priorSets = priorYears.map(y => ({ y, rows: rowsOfYear(y) }));
  const capNote = cap ? `1–${cap}월 기준` : '연간 기준';
  const pvNote = `${prevY}년 ${cap ? `1–${cap}월 ` : ''}대비`;
  /* 과거 연도 평균 — 값이 0인 해(데이터 없음)는 제외 */
  const priorAvg = (fn) => {
    const vs = priorSets.map(x => fn(x.rows)).filter(v => isFinite(v) && v !== 0);
    return vs.length ? { v: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length } : null;
  };
  const avgSub = (cur, fn, invert) => {
    const a = priorAvg(fn);
    if (!a) return '';
    return cmpSub(cur, a.v, !!invert, `직전 ${a.n}년 평균 대비`);
  };
  const nMonthsOf = (rows, pred) => new Set(rows.filter(pred).map(moOf).filter(m => m >= 1 && m <= 12)).size || 1;

  if (state.charts.yrSub) { state.charts.yrSub.destroy(); state.charts.yrSub = null; }
  if (state.charts.yrPie) { state.charts.yrPie.destroy(); state.charts.yrPie = null; }
  const PALETTE = ['#4c8c6b', '#c9a227', '#c2749b', '#7b7fd0', '#c1483f', '#39a8bd', '#d9884f'];
  const legendBox = document.getElementById('yr-sub-legend');
  const mkChart = (datasets, opts) => {
    if (legendBox) legendBox.innerHTML = datasets.filter(x => !x.hideLegend).map(x =>
      `<span><i style="background:${x.borderColor || x.backgroundColor}"></i>${x.label}</span>`).join('');
    state.charts.yrSub = new Chart(ctx, {
      data: { labels, datasets },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20, right: 6 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.raw === null ? null : ` ${c.dataset.label}: ${formatKrw(c.raw)}` } } },
        scales: {
          x: { stacked: true, ticks: MONO_TICK, grid: { display: false } },
          y: { stacked: true, ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
          y2: { position: 'right', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: { display: false } }
        }
      }, opts || {}),
      plugins: [valueLabelPlugin]
    });
  };
  const cumDs = (arr, color, label) => ({
    type: 'line', label, data: cumOf(arr), borderColor: color, backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 2, tension: .25, spanGaps: false, yAxisID: 'y2',
    hideLabel: true, order: 0
  });

  /* ---------- 수입 ---------- */
  if (sub === 'income') {
    const inc = yrRows.filter(r => r.major.includes('수입'));
    const total = inc.reduce((a, r) => a + r.amount, 0);
    const by = (kw) => inc.filter(r => String(r.minor || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
    const work = by('근로'), invest = by('투자'), side = by('부수입');
    const etc = total - work - invest - side;
    const monthly = live(bucket(inc, r => r.amount));
    const nMonths = monthsWith(monthly);
    const nonWork = total - work;
    const incOf = (rows, kw) => rows.filter(r => r.major.includes('수입') && (!kw || String(r.minor || '').includes(kw))).reduce((a, r) => a + r.amount, 0);
    const incAvgOf = (rows) => { const t = incOf(rows); const n = nMonthsOf(rows, r => r.major.includes('수입')); return n ? t / n : 0; };
    const shareOf = (rows) => { const t = incOf(rows); return t ? ((t - incOf(rows, '근로')) / t) * 100 : null; };
    const pTotal = incOf(prevRows), pWork = incOf(prevRows, '근로'), pInv = incOf(prevRows, '투자'), pSide = incOf(prevRows, '부수입');
    statBox.innerHTML = [
      yrStatCard('수입 합계', formatKrw(total),
        [cmpSub(total, pTotal, false, pvNote), avgSub(total, incOf, false), `${capNote} · 월 평균 ${formatCompactWon(nMonths ? total / nMonths : 0)}원`], 'var(--income-text)'),
      yrStatCard('월 평균', formatKrw(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(incAvgOf(prevRows)), false, pvNote), avgSub(Math.round(nMonths ? total / nMonths : 0), (rows) => Math.round(incAvgOf(rows)), false), `${nMonths}개월 기준`]),
      yrStatCard('근로소득', formatKrw(work),
        [cmpSub(work, pWork, false, pvNote), `전체의 <b>${total ? ((work / total) * 100).toFixed(0) : 0}%</b> · 작년 ${pTotal ? ((pWork / pTotal) * 100).toFixed(0) + '%' : '—'}`]),
      yrStatCard('투자수익', formatKrw(invest),
        [cmpSub(invest, pInv, false, pvNote), avgSub(invest, (rows) => incOf(rows, '투자'), false), `전체의 <b>${total ? ((invest / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('부수입', formatKrw(side),
        [cmpSub(side, pSide, false, pvNote), `전체의 <b>${total ? ((side / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('그 외', formatKrw(etc),
        [cmpSub(etc, pTotal - pWork - pInv - pSide, false, pvNote), `전체의 <b>${total ? ((etc / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('근로 외 수입 비중', (total ? ((nonWork / total) * 100).toFixed(1) : '0.0') + '%',
        [cmpSubPp(total ? (nonWork / total) * 100 : null, shareOf(prevRows), pvNote),
         { text: `근로 외 <b>${formatCompactWon(nonWork)}원</b> — 월급 밖에서 버는 힘`, tone: (total && nonWork / total >= 0.3) ? 'good' : '' }], 'var(--net-text)')
    ].join('');

    /* 색은 '이번달 › 수입'과 같은 표를 쓴다 — 화면을 옮겨도 같은 분류는 같은 색 */
    const incCmap = incomeCatColorMap(data.ledger);
    const incOrder = incomeTaxonomy(data.ledger).map(g => g.cat);
    const cats = [...new Set(inc.map(r => r.minor || '기타'))]
      .sort((a, b) => (incOrder.indexOf(a) + 1 || 99) - (incOrder.indexOf(b) + 1 || 99));
    const ds = cats.map((c) => ({
      type: 'bar', label: c, stack: 'inc',
      data: live(bucket(inc.filter(r => (r.minor || '기타') === c), r => r.amount)),
      backgroundColor: incomeCatColorOf(incCmap, c), borderRadius: 2, order: 3, hideLabel: true
    }));
    ds.push(Object.assign(cumDs(monthly, '#eae8e0', '누적 수입'), { hideLegend: false }));
    mkChart(ds);

    const pieData = cats.map(c => inc.filter(r => (r.minor || '기타') === c).reduce((a, r) => a + r.amount, 0));
    const pieCtx = document.getElementById('chart-yr-pie');
    if (pieCtx) state.charts.yrPie = new Chart(pieCtx, {
      type: 'doughnut',
      data: { labels: cats, datasets: [{ data: pieData, backgroundColor: cats.map(c => incomeCatColorOf(incCmap, c)), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '46%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${formatKrw(c.raw)}` } } } },
      plugins: [donutLabelPlugin]
    });

    const tops = yrTopSources(inc, r => r.amount, r => (r.vendor || r.item || '기타').split('›').pop().trim(), total, TOP_PCT);
    if (topBox) topBox.innerHTML = renderYrTopList(tops, total, 'var(--income-text)', TOP_PCT, '수입');
    return;
  }

  /* ---------- 지출 ---------- */
  if (sub === 'expense') {
    const exp = yrRows.filter(r => r.major.includes('지출'));
    const total = exp.reduce((a, r) => a + netOfR(r), 0);
    const fixed = exp.filter(r => r.fixed).reduce((a, r) => a + netOfR(r), 0);
    const regret = exp.filter(r => r.regret).reduce((a, r) => a + netOfR(r), 0);
    const refund = exp.reduce((a, r) => a + (r.refund || 0), 0);
    const monthly = live(bucket(exp, netOfR));
    const nMonths = monthsWith(monthly);
    const fixedMonthly = live(bucket(exp.filter(r => r.fixed), netOfR));
    const expOf = (rows, f) => rows.filter(r => r.major.includes('지출') && (!f || f(r))).reduce((a, r) => a + netOfR(r), 0);
    const expAvgOf = (rows) => { const t = expOf(rows); const n = nMonthsOf(rows, r => r.major.includes('지출')); return n ? t / n : 0; };
    const fixAvgOf = (rows) => { const t = expOf(rows, r => r.fixed); const n = nMonthsOf(rows, r => r.major.includes('지출')); return n ? t / n : 0; };
    const pTotal = expOf(prevRows), pFixed = expOf(prevRows, r => r.fixed), pRegret = expOf(prevRows, r => r.regret);
    const pRefund = prevRows.filter(r => r.major.includes('지출')).reduce((a, r) => a + (r.refund || 0), 0);
    statBox.innerHTML = [
      yrStatCard('지출 합계', formatKrw(total),
        [cmpSub(total, pTotal, true, pvNote), avgSub(total, expOf, true), `${capNote} · 월 평균 ${formatCompactWon(nMonths ? total / nMonths : 0)}원`], 'var(--expense-text)'),
      yrStatCard('월 평균 지출', formatKrw(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(expAvgOf(prevRows)), true, pvNote), avgSub(Math.round(nMonths ? total / nMonths : 0), (rows) => Math.round(expAvgOf(rows)), true), `${nMonths}개월 기준`]),
      yrStatCard('고정비', formatKrw(fixed),
        [cmpSub(fixed, pFixed, true, pvNote), cmpSubPp(total ? (fixed / total) * 100 : null, pTotal ? (pFixed / pTotal) * 100 : null, '지출 내 비중 변화'), `지출의 <b>${total ? ((fixed / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('월 평균 고정비', formatKrw(Math.round(nMonths ? fixed / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? fixed / nMonths : 0), Math.round(fixAvgOf(prevRows)), true, pvNote), `매달 반드시 나가는 돈 — 줄면 구조가 가벼워짐`]),
      yrStatCard('아낄 수 있었던 소비', formatKrw(regret),
        [cmpSub(regret, pRegret, true, pvNote), { text: `지출의 <b>${total ? ((regret / total) * 100).toFixed(1) : 0}%</b> · 작년 ${pTotal ? ((pRegret / pTotal) * 100).toFixed(1) + '%' : '—'}`, tone: (pTotal && total && (regret / total) <= (pRegret / pTotal)) ? 'good' : 'warn' }], '#e6b48f'),
      yrStatCard('회사 환급', formatKrw(refund),
        [cmpSub(refund, pRefund, false, pvNote), `이미 지출에서 차감된 금액`], 'var(--income-text)')
    ].join('');
    mkChart([
      { type: 'bar', label: '지출', data: monthly, backgroundColor: 'rgba(193,72,63,0.75)', borderRadius: 2, stack: 'e', order: 3, hideLabel: true },
      { type: 'bar', label: '고정비', data: fixedMonthly, backgroundColor: 'rgba(154,163,182,0.55)', borderRadius: 2, stack: 'f', order: 4, hideLabel: true },
      Object.assign(cumDs(monthly, '#eae8e0', '누적 지출'), { hideLegend: false })
    ]);
    const tops = yrTopSources(exp, netOfR, r => (r.vendor || r.item || '기타').split('›').pop().trim(), total, TOP_PCT);
    if (topBox) topBox.innerHTML = renderYrTopList(tops, total, 'var(--expense-text)', TOP_PCT, '지출');
    return;
  }

  /* ---------- 순저축 ---------- */
  if (sub === 'saving') {
    const inc = yrRows.filter(r => r.major.includes('수입'));
    const exp = yrRows.filter(r => r.major.includes('지출'));
    const incM = bucket(inc, r => r.amount), expM = bucket(exp, netOfR);
    const netM = live(incM.map((v, i) => v - expM[i]));
    const total = netM.reduce((a, v) => a + (v || 0), 0);
    const incTot = inc.reduce((a, r) => a + r.amount, 0);
    const nMonths = monthsWith(netM);
    const trTot = yrRows.filter(r => r.major.includes('이체')).reduce((a, r) => a + r.amount, 0);
    const activeM = incM.map((v, i) => (v !== 0 || expM[i] !== 0));
    const best = netM.reduce((a, v, i) => (v !== null && activeM[i] && (a === null || v > netM[a])) ? i : a, null);
    const netOfYear = (rows) => rows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0)
      - rows.filter(r => r.major.includes('지출')).reduce((a, r) => a + netOfR(r), 0);
    const netAvgOf = (rows) => { const n = nMonthsOf(rows, r => r.major.includes('수입') || r.major.includes('지출')); return n ? netOfYear(rows) / n : 0; };
    const rateOf = (rows) => { const i = rows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0); return i > 0 ? (netOfYear(rows) / i) * 100 : null; };
    const trOf = (rows) => rows.filter(r => r.major.includes('이체')).reduce((a, r) => a + r.amount, 0);
    const pNetY = netOfYear(prevRows);
    const curRate = incTot > 0 ? (total / incTot) * 100 : null;
    statBox.innerHTML = [
      yrStatCard('순저축 합계', formatKrw(total),
        [cmpSub(total, pNetY, false, pvNote), avgSub(total, netOfYear, false), `${capNote} · 수입 ${formatCompactWon(incTot)} − 지출 ${formatCompactWon(incTot - total)}`], total >= 0 ? 'var(--net-text)' : 'var(--expense-text)'),
      yrStatCard('월 평균 순저축', formatKrw(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(netAvgOf(prevRows)), false, pvNote), avgSub(Math.round(nMonths ? total / nMonths : 0), (rows) => Math.round(netAvgOf(rows)), false), `${nMonths}개월 기준`]),
      yrStatCard('저축률', curRate === null ? '—' : curRate.toFixed(1) + '%',
        [cmpSubPp(curRate, rateOf(prevRows), pvNote),
         { text: `목표 ${state.goals.savingsRateTarget}% 대비 ${curRate === null ? '—' : (curRate - state.goals.savingsRateTarget).toFixed(1) + '%p'}`, tone: curRate !== null && curRate >= state.goals.savingsRateTarget ? 'good' : 'warn' }]),
      yrStatCard('자산으로 옮긴 돈', formatKrw(trTot),
        [cmpSub(trTot, trOf(prevRows), false, pvNote), `순저축의 <b>${total > 0 ? ((trTot / total) * 100).toFixed(0) + '%' : '—'}</b> · 나머지는 통장에 남음`], 'var(--transfer-text)'),
      yrStatCard('가장 많이 모은 달', best === null ? '—' : (best + 1) + '월', [best === null ? '' : formatKrw(netM[best]) + ' 저축'])
    ].join('');
    mkChart([
      { type: 'bar', label: '월 순저축', data: netM, backgroundColor: netM.map(v => (v || 0) >= 0 ? 'rgba(57,168,189,0.75)' : 'rgba(193,72,63,0.75)'), borderRadius: 2, order: 3, hideLabel: true },
      Object.assign(cumDs(netM, '#eae8e0', '누적 순저축'), { hideLegend: false })
    ]);
    return;
  }

  /* ---------- 투자 ---------- */
  if (sub === 'invest') {
    const inv = yrRows.filter(r => r.major.includes('수입') && String(r.minor || '').includes('투자'));
    const total = inv.reduce((a, r) => a + r.amount, 0);
    const itemSum = (kw) => inv.filter(r => String(r.item || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
    const sale = itemSum('판매수익'), dividend = itemSum('배당'), interest = itemSum('이자');
    const principal = yrRows.filter(r => r.major.includes('이체') && String(r.minor || '').includes('투자')).reduce((a, r) => a + r.amount, 0);
    const t = analyzeCapitalGainsTax(data.ledger || []);
    const taxPaid = t.paid[Y] || 0;
    const taxRow = t.rows.find(x => x.year === Y);
    const valSeries = yrAssetSeries(data.assetRows, Y, /투자/);
    const first = valSeries.find(v => v !== null && v !== undefined);
    const lastIdx = valSeries.reduce((a, v, i) => v !== null ? i : a, -1);
    const last = lastIdx >= 0 ? valSeries[lastIdx] : null;
    const ytdPL = (first !== undefined && first !== null && last !== null && lastIdx >= 0) ? (last - first - principal) : null;
    const monthly = live(bucket(inv, r => r.amount));
    const nMonths = monthsWith(monthly);
    const invOf = (rows, kw) => rows.filter(r => r.major.includes('수입') && String(r.minor || '').includes('투자') && (!kw || String(r.item || '').includes(kw))).reduce((a, r) => a + r.amount, 0);
    const invAvgOf = (rows) => { const n = nMonthsOf(rows, r => r.major.includes('수입') && String(r.minor || '').includes('투자')); return n ? invOf(rows) / n : 0; };
    const prinOf = (rows) => rows.filter(r => r.major.includes('이체') && String(r.minor || '').includes('투자')).reduce((a, r) => a + r.amount, 0);
    const pTotal = invOf(prevRows), pSale = invOf(prevRows, '판매수익'), pDiv = invOf(prevRows, '배당'), pPrin = prinOf(prevRows);
    const pTax = t.paid[prevY] || 0;
    /* 작년 같은 시점 평가손익 */
    const pVal = yrAssetSeries(data.assetRows, prevY, /투자/);
    const pFirst = pVal.find(v => v !== null && v !== undefined);
    const pCapIdx = (cap ? cap : 12) - 1;
    let pLastIdx = -1; for (let i = 0; i <= pCapIdx; i++) if (pVal[i] !== null) pLastIdx = i;
    const pYtdPL = (pFirst != null && pLastIdx >= 0) ? (pVal[pLastIdx] - pFirst - pPrin) : null;
    statBox.innerHTML = [
      yrStatCard('투자수익 합계', formatKrw(total),
        [cmpSub(total, pTotal, false, pvNote), avgSub(total, invOf, false), `${capNote} · 판매 ${formatCompactWon(sale)} · 배당 ${formatCompactWon(dividend)}`], total >= 0 ? 'var(--income-text)' : 'var(--expense-text)'),
      yrStatCard('월 평균 투자수익', formatKrw(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(invAvgOf(prevRows)), false, pvNote), `${nMonths}개월 기준`]),
      yrStatCard('판매수익', formatKrw(sale),
        [cmpSub(sale, pSale, false, pvNote), `실현손익 · 양도세 과세 대상`]),
      yrStatCard('배당금', formatKrw(dividend),
        [cmpSub(dividend, pDiv, false, pvNote), avgSub(dividend, (rows) => invOf(rows, '배당'), false), `이자 ${formatCompactWon(interest)}원 별도`]),
      yrStatCard('세금', formatKrw(taxPaid),
        [cmpSub(taxPaid, pTax, true, `${prevY}년 납부액 대비`), taxRow ? `${Y}년 실현손익 기준 예상 ${formatCompactWon(Math.round(taxRow.est))}원` : '해당 연도 납부 내역'], 'var(--expense-text)'),
      yrStatCard('올해 누적 원금', formatKrw(principal),
        [cmpSub(principal, pPrin, false, pvNote), avgSub(principal, prinOf, false), `투자 계좌로 새로 넣은 돈`], 'var(--transfer-text)'),
      yrStatCard('연초 대비 평가손익', ytdPL === null ? '—' : formatKrw(ytdPL),
        [cmpSub(ytdPL === null ? 0 : ytdPL, pYtdPL, false, `${prevY}년 같은 시점 대비`),
         { text: first == null ? '평가액 스냅샷 부족' : `${formatCompactWon(first)} → ${formatCompactWon(last)} (원금 유입 ${formatCompactWon(principal)} 제외)`, tone: (ytdPL || 0) >= 0 ? 'good' : 'warn' }],
        (ytdPL || 0) >= 0 ? 'var(--net-text)' : 'var(--expense-text)')
    ].join('');
    mkChart([
      { type: 'bar', label: '월말 평가액', data: valSeries, backgroundColor: 'rgba(201,162,39,0.7)', borderRadius: 2, order: 3, hideLabel: true },
      { type: 'line', label: '실현수익 누적', data: cumOf(monthly), borderColor: '#4c8c6b', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, tension: .25, yAxisID: 'y2', hideLabel: true, order: 0 }
    ]);

    const tagOf = {};
    (data.investmentTags || []).forEach(x => { tagOf[x.stock] = (x.tags || []).join(' · '); });
    const nameOf = (r) => (r.vendor || '기타').split('›').pop().trim();
    const tops = yrTopSources(inv, r => r.amount, nameOf, total, TOP_PCT);
    if (topBox) topBox.innerHTML = renderYrTopList(tops, total, 'var(--income-text)', TOP_PCT, '투자수익', tagOf);
    return;
  }
}

function renderYrTopList(rows, total, color, pct, kindLabel, tagOf) {
  if (!rows.length) return `<div class="empty-state">합계의 ${pct}% (${formatCompactWon(Math.round(Math.abs(total) * pct / 100))}원)를 넘는 ${kindLabel}처가 없어요. 고르게 분산돼 있습니다.</div>`;
  const max = Math.max(...rows.map(r => r.v), 1);
  return `<div class="yr-list">
    ${rows.map(r => `<div class="yr-row">
      <span class="yr-y" style="font-family:var(--sans);font-size:12.5px;">${r.name}${tagOf && tagOf[r.name] ? `<em>${tagOf[r.name]}</em>` : `<em>${r.n}건</em>`}</span>
      <span class="yr-track"><i style="width:${(r.v / max) * 100}%;background:${color}"></i></span>
      <span class="yr-net" style="color:${color}">${formatCompactWon(r.v)}</span>
      <span class="yr-rate">${total ? ((r.v / total) * 100).toFixed(0) + '%' : '—'}</span>
    </div>`).join('')}
    <div class="settings-note">합계의 <b>${pct}%</b> 이상만 노출 · ${rows.length}곳이 전체의 <b>${total ? ((rows.reduce((a, r) => a + r.v, 0) / total) * 100).toFixed(0) : 0}%</b>를 차지합니다.</div>
  </div>`;
}
