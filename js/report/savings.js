/* 저축 / 연금 탭 공통 렌더러.
   scope = 'saving' | 'pension' — 카테고리·이체 채널·색만 다르고 구조는 같다. */
const SAV_SCOPES = {
  saving: {
    cat: '저축 자산', label: '저축', color: '#c2749b',
    transfers: ['비상금'], transferLabel: { '비상금': '저축(CMA 등)' },
    minors: ['저축 자산', '비상금']
  },
  pension: {
    cat: '연금 자산', label: '연금', color: '#9b7fc2',
    transfers: ['연금 자산'], transferLabel: { '연금 자산': '연금 이체' },
    minors: ['연금 자산']
  }
};

function renderSavingsPage(container, data, d, scopeKey) {
  const S = SAV_SCOPES[scopeKey] || SAV_SCOPES.saving;
  const byMonth = {};
  data.assetRows.forEach(r => {
    if (r.category !== S.cat || r.amount === null) return;
    byMonth[r.date] = (byMonth[r.date] || 0) + r.amount;
  });
  const months = d.assetMonths;
  const latestMonth = d.latestMonth;
  const total = byMonth[latestMonth] || 0;
  const prevMonth = months[months.indexOf(latestMonth) - 1];
  const prev = prevMonth ? (byMonth[prevMonth] || 0) : null;
  const delta = prev === null ? null : total - prev;
  const sharePct = d.totalAssets ? (total / d.totalAssets) * 100 : 0;

  const latestTransferIdx = d.latestPivotIdx;
  const transferNames = S.transfers.filter(n => data.transferCategories[n]);
  const monthTransfer = transferNames.reduce((a, n) => a + ((data.transferCategories[n] || [])[latestTransferIdx] || 0), 0);
  const yearTransfer = transferNames.reduce((a, n) => a + (data.transferCategories[n] || []).slice(-12).reduce((x, v) => x + (v || 0), 0), 0);

  const accounts = {};
  data.assetRows.filter(r => r.date === latestMonth && r.category === S.cat).forEach(r => {
    accounts[r.account] = (accounts[r.account] || 0) + r.amount;
  });
  const accountList = Object.entries(accounts).sort((a, b) => b[1] - a[1]);

  const scopeLedger = data.ledger.filter(r => S.minors.includes(r.minor));

  /* 저축: 비상금 목표 / 연금: 세액공제 한도 */
  let gaugeHtml = '';
  if (scopeKey === 'saving') {
    const emgName = state.settings.emergencyAccount || '';
    const cma = Object.entries(accounts).filter(([n]) => sameAcct(n, emgName)).reduce((a, [, v]) => a + v, 0);
    const tgt = state.goals.emergencyFundTarget || 0;
    const pct = tgt ? Math.min((cma / tgt) * 100, 100) : 0;
    gaugeHtml = `
      <div class="stat-card">
        <div class="label">비상금${emgName ? ` (${enEsc(emgName)})` : ''}</div>
        <div class="value" style="color:${tgt && cma >= tgt ? 'var(--income-text)' : 'var(--accent-text)'}">${formatCompactWon(cma)}원</div>
        <div class="allow-track" style="margin-top:8px;height:7px;"><div class="allow-fill" style="width:${pct}%;${tgt && cma >= tgt ? '' : 'background:linear-gradient(90deg,var(--gold),var(--gold-soft));'}"></div></div>
        <div class="allow-legend"><span>목표 ${formatCompactWon(tgt)}원</span><span>${tgt ? Math.round((cma / tgt) * 100) : 0}%</span></div>
      </div>`;
  } else {
    const annPension = (data.transferCategories['연금 자산'] || []).slice(-12).reduce((a, v) => a + (v || 0), 0);
    const pct = Math.max(0, Math.min((annPension / PENSION_LIMIT) * 100, 100));
    gaugeHtml = `
      <div class="stat-card">
        <div class="label">세액공제 한도</div>
        <div class="value" style="color:${pct >= 100 ? 'var(--income-text)' : annPension <= 0 ? 'var(--expense-text)' : 'var(--accent-text)'}">${pct.toFixed(0)}%</div>
        <div class="allow-track" style="margin-top:8px;height:7px;"><div class="allow-fill" style="width:${pct}%;${pct >= 100 ? '' : 'background:linear-gradient(90deg,var(--gold),var(--gold-soft));'}"></div></div>
        <div class="allow-legend"><span>최근 12개월 ${formatCompactWon(annPension)}원</span><span>한도 ${formatCompactWon(PENSION_LIMIT)}원</span></div>
      </div>`;
  }

  container.innerHTML = `
    <div class="g">
      <div class="stat-grid s5" style="grid-template-columns:1fr 1fr;">
        <div class="stat-card">
          <div class="label">${S.label} 자산</div>
          <div class="value" style="color:${S.color}">${formatCompactWon(total)}원</div>
          <div class="sub ${delta === null ? '' : delta >= 0 ? 'good' : 'warn'}">${delta === null ? latestMonth || '' : `전월 ${delta >= 0 ? '▲' : '▼'} ${formatCompactWon(Math.abs(delta))}원`}</div>
        </div>
        <div class="stat-card">
          <div class="label">총자산 비중</div>
          <div class="value">${sharePct.toFixed(0)}%</div>
          <div class="sub">총자산 ${formatCompactWon(d.totalAssets)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">이번 달 이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatCompactWon(monthTransfer)}원</div>
          <div class="sub">최근 12개월 ${formatCompactWon(yearTransfer)}원</div>
        </div>
        ${gaugeHtml}
      </div>
      <div class="panel s7">
        <div class="panel-title"><div>계좌별 잔액</div><span class="ptag">${latestMonth || ''}</span></div>
        ${accountList.map(([name, amt]) => {
          const pct = total ? (amt / total) * 100 : 0;
          return `<div class="acct-row">
            <span class="alloc-swatch" style="background:${S.color}"></span>
            <span class="acct-name">${name}</span>
            <span class="acct-amt">${amtPct(amt, pct)}</span>
          </div>`;
        }).join('') || '<div class="empty-state">계좌 데이터가 없어요.</div>'}
      </div>
    </div>
    ${scopeKey === 'pension' ? '<div class="g"><div class="panel s12" id="panel-idle-pension"></div></div>' : ''}
    <div class="g">
      <div class="panel s6">
        <div class="panel-title">
          <div>${S.label} 자산 추이</div>
          <div class="range-toggle" id="sav-trend-range-toggle"></div>
        </div>
        <div class="chart-wrap tall"><canvas id="chart-sav-trend"></canvas></div>
      </div>
      <div class="panel s6">
        <div class="panel-title">
          <div>월별 ${S.label} 이체</div>
          <div class="range-toggle" id="sav-contrib-range-toggle"></div>
        </div>
        <div class="chart-wrap tall"><canvas id="chart-sav-contrib"></canvas></div>
      </div>
    </div>
  `;

  if (scopeKey === 'pension') renderIdlePanel('panel-idle-pension', data, d, ['연금 자산'], '연금 운용 점검');

  const drawSavTrend = () => {
    const monthsSlice = sliceByRange(months, state.savTrendRange);
    if (state.charts.savTrend) state.charts.savTrend.destroy();
    state.charts.savTrend = new Chart(document.getElementById('chart-sav-trend'), {
      type: 'line',
      data: {
        labels: monthsSlice.map(assetMonthLabel),
        datasets: [
          { label: `${S.label} 자산`, data: monthsSlice.map(m => byMonth[m] || 0), borderColor: S.color, backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, labelColor: S.color }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
      },
      plugins: [valueLabelPlugin]
    });
  };
  function onSavTrendRangePick(v) {
    state.savTrendRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('sav-trend-range-toggle', RANGE_OPTIONS, state.savTrendRange, onSavTrendRangePick);
    drawSavTrend();
  }
  bindRangeToggle('sav-trend-range-toggle', RANGE_OPTIONS, state.savTrendRange, onSavTrendRangePick);
  drawSavTrend();

  const drawSavContrib = () => {
    const monthsSlice = sliceByRange(data.months, state.savContribRange);
    const n = monthsSlice.length;
    if (state.charts.savContrib) state.charts.savContrib.destroy();
    state.charts.savContrib = new Chart(document.getElementById('chart-sav-contrib'), {
      type: 'bar',
      data: {
        labels: monthsSlice.map(pivotMonthLabel),
        datasets: transferNames.map(name => ({
          label: S.transferLabel[name] || name,
          data: (data.transferCategories[name] || []).slice(-n).map(v => v || 0),
          backgroundColor: S.color, stack: 's'
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: { x: { stacked: true, ticks: MONO_TICK, grid: { display: false } }, y: { stacked: true, ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
      },
      plugins: [stackTotalLabelPlugin]
    });
  };
  function onSavContribRangePick(v) {
    state.savContribRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('sav-contrib-range-toggle', RANGE_OPTIONS, state.savContribRange, onSavContribRangePick);
    drawSavContrib();
  }
  bindRangeToggle('sav-contrib-range-toggle', RANGE_OPTIONS, state.savContribRange, onSavContribRangePick);
  drawSavContrib();
}

