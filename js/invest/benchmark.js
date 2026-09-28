/* ---------------- BENCHMARK: 같은 일정으로 지수에 넣었다면 ----------------
   "내가 고른 종목"과 "아무 생각 없이 지수"를 같은 조건에서 비교한다.
   조건을 맞추는 방법: 실제 투자 이체가 일어난 달·금액 그대로 지수를 매수했다고
   가정하고, 매달 누적 좌수 × 그 달 지수 = 반사실 평가액.
   실제 평가액(자산 스냅샷의 투자 자산)과 같은 시점에서 뺀 값이 초과수익.
   이 패널이 있어야 "이겼다/졌다"를 기억이 아니라 숫자로 판정할 수 있다. */
function analyzeBenchmark(data, d) {
  const prices = data.indexPrices || {};
  if (!Object.keys(prices).length) return null;

  const sortedPriceKeys = Object.keys(prices).sort();
  /* 해당 월 가격이 없으면 그 이전 가장 가까운 달 가격으로 대체한다.
     (시트 갱신이 한 달 밀렸을 때 패널이 죽지 않게) */
  const priceAt = (key) => {
    if (prices[key] !== undefined) return prices[key];
    let found = null;
    for (const k of sortedPriceKeys) { if (k <= key) found = prices[k]; else break; }
    return found;
  };

  /* 1) 납입 스케줄.
     원장이 충분하면 원장에서 뽑는다 — 계좌별로 나뉘어 있어서
     "이체 기록이 있는 계좌"만 비교 대상으로 좁힐 수 있다.
     신한 증권처럼 이체 기록 없이 잔고만 있는 계좌를 실제 평가액에 넣으면
     그 금액만큼 초과수익이 매달 공짜로 부풀려진다. */
  const monthKeyOf = (pivotMonth) => {
    const m = String(pivotMonth).match(/(\d{4})-(\d{1,2})월/);
    return m ? `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, '0')}` : null;
  };
  const ledgerMonthKey = (s) => {
    const m = String(s || '').match(/(\d{4})\.\s*(\d{1,2})\./);
    return m ? `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, '0')}` : null;
  };

  const pivotSeries = data.transferCategories['투자 자산'] || [];
  const pivotFlow = {};
  let pivotTotal = 0;
  data.months.forEach((pm, i) => {
    const key = monthKeyOf(pm);
    if (!key) return;
    pivotFlow[key] = (pivotFlow[key] || 0) + (pivotSeries[i] || 0);
    pivotTotal += pivotSeries[i] || 0;
  });

  const invTransfers = (data.ledger || []).filter(r => r.major === '이체' && r.minor === '투자 자산');
  const ledgerFlow = {};
  const trackedAccounts = new Set();
  let ledgerTotal = 0;
  invTransfers.forEach(r => {
    const key = ledgerMonthKey(r.date);
    if (!key) return;
    ledgerFlow[key] = (ledgerFlow[key] || 0) + (r.amount || 0);
    ledgerTotal += r.amount || 0;
    if (r.item) trackedAccounts.add(r.item);
  });

  /* 원장 쪽이 피벗 총액을 거의 재현할 때만 원장을 신뢰한다.
     오프라인 스냅샷의 ledger는 앞부분만 잘려 담겨 있어서, 건수만 보고
     원장을 쓰면 누적 원금이 조용히 과소 집계된다. */
  const ledgerAgrees = pivotTotal === 0
    ? invTransfers.length >= 10
    : Math.abs(ledgerTotal - pivotTotal) <= Math.abs(pivotTotal) * 0.02;
  const useLedger = invTransfers.length >= 10 && ledgerAgrees;

  const flowByKey = useLedger ? ledgerFlow : pivotFlow;
  if (!useLedger) trackedAccounts.clear();

  /* 2) 시간순으로 누적 좌수와 누적 원금을 쌓는다 */
  let units = 0, contrib = 0, missing = 0;
  const stateByKey = {};
  const allKeys = Array.from(new Set(Object.keys(flowByKey).concat(sortedPriceKeys))).sort();
  allKeys.forEach(key => {
    const flow = flowByKey[key] || 0;
    if (flow !== 0) {
      const px = priceAt(key);
      if (px) { units += flow / px; contrib += flow; }
      else { missing += 1; contrib += flow; }
    }
    stateByKey[key] = { units, contrib };
  });

  /* 3) 자산 스냅샷이 있는 달마다 실제 vs 반사실을 같은 시점으로 맞춘다.
     원장을 쓸 수 있으면 이체 기록이 있는 계좌만 합산한다. */
  const balByMonth = {};
  const excluded = new Set();
  data.assetRows.forEach(r => {
    if (r.category !== '투자 자산' || r.amount === null) return;
    if (useLedger && trackedAccounts.size && !trackedAccounts.has(r.account)) {
      excluded.add(r.account);
      return;
    }
    balByMonth[r.date] = (balByMonth[r.date] || 0) + r.amount;
  });

  const carry = (key) => {
    if (stateByKey[key]) return stateByKey[key];
    const keys = Object.keys(stateByKey).filter(k => k <= key).sort();
    return keys.length ? stateByKey[keys[keys.length - 1]] : { units: 0, contrib: 0 };
  };

  const rows = [];
  (d.assetMonths || []).forEach(am => {
    const mk = assetMonthKey(am);
    if (!mk) return;
    const key = `${Math.floor(mk / 100)}-${String(mk % 100).padStart(2, '0')}`;
    const px = priceAt(key);
    const st = carry(key);
    const actual = balByMonth[am];
    if (px === null || px === undefined || actual === undefined) return;
    const index = st.units * px;
    rows.push({
      month: am, key, contrib: st.contrib, actual, index,
      diff: actual - index,
      actualRoi: st.contrib > 0 ? ((actual - st.contrib) / st.contrib) * 100 : null,
      indexRoi: st.contrib > 0 ? ((index - st.contrib) / st.contrib) * 100 : null
    });
  });
  if (!rows.length) return null;

  const last = rows[rows.length - 1];
  const best = rows.reduce((a, r) => (r.diff > a.diff ? r : a), rows[0]);
  const worst = rows.reduce((a, r) => (r.diff < a.diff ? r : a), rows[0]);
  const wins = rows.filter(r => r.diff > 0).length;

  return {
    rows, last, best, worst, wins, total: rows.length, missing,
    source: data.indexSource || 'db',
    accounts: Array.from(trackedAccounts), excluded: Array.from(excluded), useLedger
  };
}

function renderBenchmarkPanel(hostId, data, d) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const b = analyzeBenchmark(data, d);
  if (!b) {
    host.innerHTML = `
      <div class="panel-title"><div>지수 대비 초과수익</div></div>
      <div class="empty-state">지수 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</div>`;
    return;
  }

  const { last, best, worst, wins, total } = b;
  const sign = (v) => (v >= 0 ? '+' : '−');
  const col = (v) => (v >= 0 ? 'var(--income-text)' : 'var(--expense-text)');
  const pct = (v) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);

  host.innerHTML = `
    <div class="panel-title">
      <div>지수 대비 초과수익 — 같은 일정으로 S&amp;P500에 넣었다면</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div class="range-toggle" id="bench-mode-toggle">
          <button data-mode="amount" class="${state.benchMode !== 'excess' ? 'active' : ''}">금액</button>
          <button data-mode="excess" class="${state.benchMode === 'excess' ? 'active' : ''}">초과수익</button>
        </div>
        <div class="range-toggle" id="bench-range-toggle"></div>
      </div>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(122px,1fr));margin-bottom:10px;">
      <div class="stat-card" style="border-color:${last.diff >= 0 ? 'rgba(76,140,107,0.45)' : 'rgba(193,72,63,0.45)'};">
        <div class="label">${assetMonthLabel(last.month)} 초과수익</div>
        <div class="value" style="color:${col(last.diff)}">${sign(last.diff)}${formatCompactWon(Math.abs(last.diff))}원</div>
        <div class="sub ${last.actualRoi == null || last.indexRoi == null ? '' : last.actualRoi >= last.indexRoi ? 'good' : 'warn'}">내 ${pct(last.actualRoi)} vs 지수 ${pct(last.indexRoi)}</div>
      </div>
      <div class="stat-card">
        <div class="label">최고 초과수익</div>
        <div class="value" style="color:${col(best.diff)}">${sign(best.diff)}${formatCompactWon(Math.abs(best.diff))}원</div>
        <div class="sub">${assetMonthLabel(best.month)} 시점</div>
      </div>
      <div class="stat-card">
        <div class="label">최저 초과수익</div>
        <div class="value" style="color:${col(worst.diff)}">${sign(worst.diff)}${formatCompactWon(Math.abs(worst.diff))}원</div>
        <div class="sub">${assetMonthLabel(worst.month)} 시점</div>
      </div>
      <div class="stat-card">
        <div class="label">지수를 이긴 달</div>
        <div class="value">${wins} / ${total}</div>
        <div class="sub">스냅샷 기준 승률 ${total ? Math.round((wins / total) * 100) : 0}%</div>
      </div>
    </div>
    <div class="chart-wrap tall"><canvas id="chart-bench"></canvas></div>
    <div class="chart-legend" id="bench-legend"></div>
    <div class="table-scroll" style="margin-top:12px;">
      <table class="data-table">
        <thead><tr>
          <th>시점</th><th style="text-align:right">누적 납입</th><th style="text-align:right">내 평가액</th>
          <th style="text-align:right">지수 반사실</th><th style="text-align:right">초과수익</th>
          <th style="text-align:right">내 수익률</th><th style="text-align:right">지수 수익률</th><th>판정</th>
        </tr></thead>
        <tbody>
          ${b.rows.slice().reverse().map(r => `<tr>
            <td>${assetMonthLabel(r.month)}</td>
            <td class="amt">${formatWon(r.contrib)}</td>
            <td class="amt">${formatWon(r.actual)}</td>
            <td class="amt">${formatWon(Math.round(r.index))}</td>
            <td class="amt" style="color:${col(r.diff)}">${r.diff >= 0 ? '+' : '-'}${wonComma(r.diff)}</td>
            <td class="amt">${pct(r.actualRoi)}</td>
            <td class="amt">${pct(r.indexRoi)}</td>
            <td style="color:${col(r.diff)}">${r.diff >= 0 ? '내가 앞섬' : '지수가 앞섬'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <details class="mininote"><summary>계산 기준 · 한계</summary>
      동일 시점·동일 금액으로 지수를 샀다고 가정 (누적 좌수 × 그 달 종가) → 차이 = 종목 선택의 결과.
      종가는 월평균이고 배당 재투자 미반영 → 지수 연 1.3%p 과소평가. 환율·국내주식 혼재분은 부정확. 양도세 미반영.
      ${b.accounts.length ? `<br>대상 계좌: <b>${b.accounts.join(', ')}</b>` : ''}
      ${b.excluded.length ? `<br>제외 계좌: <b>${b.excluded.join(', ')}</b> (이체 기록 없음)` : ''}
      ${!b.useLedger ? `<br><b style="color:var(--accent-text)">원장이 얕아 월별 피벗 기준 · 계좌 분리 없음</b>` : ''}
      ${b.missing ? `<br><b style="color:var(--expense-text)">${b.missing}개 달 지수 결측 → 이전 달 종가 대체</b>` : ''}

    </details>
  `;

  const drawBench = () => {
    if (state.charts.bench) state.charts.bench.destroy();
    const slice = sliceByRange(b.rows, state.benchRange);
    const labels = slice.map(r => assetMonthLabel(r.month));
    const ctx = document.getElementById('chart-bench');
    if (!ctx) return;
    const excess = state.benchMode === 'excess';

    document.getElementById('bench-legend').innerHTML = excess
      ? '<span><i style="background:var(--accent-fill)"></i>초과수익 (내 평가액 − 지수 반사실)</span>'
      : '<span><i style="background:var(--income-fill)"></i>내 평가액</span><span><i style="background:var(--info-fill)"></i>지수 반사실</span><span><i style="background:var(--accent-text)"></i>누적 납입</span>';

    if (excess) {
      state.charts.bench = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: '초과수익', data: slice.map(r => Math.round(r.diff)),
            backgroundColor: slice.map(r => (r.diff >= 0 ? 'rgba(76,140,107,0.65)' : 'rgba(193,72,63,0.65)')),
            borderColor: slice.map(r => (r.diff >= 0 ? '#4c8c6b' : '#c1483f')), borderWidth: 1
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` 초과수익: ${formatWon(c.raw)}` } } },
          scales: {
            x: { ticks: MONO_TICK, grid: { display: false } },
            y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
          }
        }
      });
      return;
    }

    state.charts.bench = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '내 평가액', data: slice.map(r => r.actual), borderColor: '#4c8c6b', backgroundColor: 'rgba(76,140,107,0.12)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: '지수 반사실', data: slice.map(r => Math.round(r.index)), borderColor: '#5b8fc7', backgroundColor: 'transparent', borderDash: [6, 4], tension: 0.3, pointRadius: 2 },
          { label: '누적 납입', data: slice.map(r => r.contrib), borderColor: '#e0c766', backgroundColor: 'transparent', borderDash: [2, 3], borderWidth: 1.5, tension: 0.3, pointRadius: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: {
          x: { ticks: MONO_TICK, grid: { display: false } },
          y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
        }
      }
    });
  };

  function onBenchRangePick(v) {
    state.benchRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('bench-range-toggle', RANGE_OPTIONS, state.benchRange, onBenchRangePick);
    drawBench();
  }
  bindRangeToggle('bench-range-toggle', RANGE_OPTIONS, state.benchRange, onBenchRangePick);

  const modeToggle = document.getElementById('bench-mode-toggle');
  if (modeToggle) {
    modeToggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.benchMode = btn.dataset.mode;
        modeToggle.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === btn));
        drawBench();
      });
    });
  }
  drawBench();
}

function renderCapitalGainsPanel(hostId, ledger) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const t = analyzeCapitalGainsTax(ledger);
  if (!t.rows.length) { host.innerHTML = ''; return; }

  const pending = t.rows.filter(r => !r.settled);
  const upcoming = pending.length ? pending[pending.length - 1] : null;
  const settledRows = t.rows.filter(r => r.settled);
  const accuracy = settledRows.length
    ? avgOf(settledRows.map(r => (r.est > 0 ? (r.actual / r.est) * 100 : 100)))
    : null;

  host.innerHTML = `
    <div class="panel-title"><div>양도소득세 · 세후 실현수익</div></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(122px,1fr));margin-bottom:10px;">
      <div class="stat-card">
        <div class="label">지금까지 낸 양도세</div>
        <div class="value" style="color:var(--expense-text)">${formatCompactWon(t.totalPaid)}원</div>
        <div class="sub">누적 실현손익 ${formatCompactWon(t.totalGain)}원</div>
      </div>
      <div class="stat-card">
        <div class="label">${upcoming ? `${upcoming.payYear}년 5월 예상 납부액` : '미납 예정 세액'}</div>
        <div class="value" style="color:var(--accent-text)">${upcoming ? formatCompactWon(Math.round(upcoming.est)) + '원' : '없음'}</div>
        <div class="sub">${upcoming ? `${upcoming.year}년 실현손익 ${formatCompactWon(upcoming.gain)}원 기준` : '모두 정산 완료'}</div>
      </div>
      <div class="stat-card">
        <div class="label">누적 세후 실현수익</div>
        <div class="value" style="color:var(--income-text)">${formatCompactWon(t.rows.reduce((a, r) => a + r.net, 0))}원</div>
        <div class="sub">배당 제외, 판매수익 기준</div>
      </div>
      <div class="stat-card">
        <div class="label">추정 정확도</div>
        <div class="value">${accuracy === null ? '—' : accuracy.toFixed(0) + '%'}</div>
        <div class="sub">실제 납부 ÷ 22% 추정</div>
      </div>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>과세연도</th><th style="text-align:right">실현손익</th><th style="text-align:right">과세표준</th>
          <th style="text-align:right">추정 세액</th><th style="text-align:right">실제 납부</th>
          <th style="text-align:right">세후 실현수익</th><th style="text-align:right">실효세율</th><th>상태</th>
        </tr></thead>
        <tbody>
          ${t.rows.slice().reverse().map(r => `<tr>
            <td>${r.year}년</td>
            <td class="amt income">${formatWon(r.gain)}</td>
            <td class="amt">${formatWon(Math.max(0, r.gain - CGT_DEDUCTION))}</td>
            <td class="amt">${formatWon(Math.round(r.est))}</td>
            <td class="amt expense">${r.settled ? formatWon(r.actual) : '—'}</td>
            <td class="amt" style="color:var(--income-text)">${formatWon(Math.round(r.net))}</td>
            <td class="amt">${r.rate.toFixed(1)}%</td>
            <td style="color:${r.settled ? 'var(--text-faint)' : 'var(--accent-text)'}">${r.settled ? `${r.payYear}.05 납부` : `${r.payYear}.05 예정`}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <details class="mininote"><summary>계산 기준</summary>
      추정 세액 = (실현손익 − 250만원) × 22% · 국내 상장주식 비과세분 제외 전이라 <b>상한선</b>.
      가계부에는 지출 › 기타로 잡히지만 성격은 투자 비용.
    </details>
  `;
}
