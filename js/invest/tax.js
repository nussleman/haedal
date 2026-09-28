/* ---------------- 해외주식 양도소득세 ---------------- */
/* 실현손익(판매수익)은 '수입'으로, 그에 대한 양도소득세는 이듬해 5월에 '지출'로 잡힌다.
   두 흐름이 서로 다른 해에 서로 다른 대분류로 흩어져 있어서,
   여기서 과세연도 기준으로 다시 붙여준다. */
const CGT_DEDUCTION = 2500000;   // 기본공제 250만원
const CGT_RATE = 0.22;           // 양도소득세 20% + 지방소득세 2%
const CGT_RE = /양도소득세|양도세/;

function analyzeCapitalGainsTax(ledger) {
  const gain = {}, div = {}, paid = {}, paidRows = [];
  ledger.forEach(r => {
    const mk = ledgerMonthKey(r.date);
    if (!mk) return;
    const y = mk.slice(0, 4);
    if (r.major.includes('수입') && (r.minor || '').includes('투자 수익')) {
      if ((r.item || '').includes('판매수익')) gain[y] = (gain[y] || 0) + r.amount;
      else if ((r.item || '').includes('배당')) div[y] = (div[y] || 0) + r.amount;
    }
    if (r.major.includes('지출') && CGT_RE.test(`${r.item} ${r.memo} ${r.vendor}`)) {
      paid[y] = (paid[y] || 0) + r.amount;
      paidRows.push({ date: r.date, monthKey: mk, amount: r.amount, label: r.memo || r.item });
    }
  });

  const years = Array.from(new Set(Object.keys(gain).concat(Object.keys(paid)))).sort();
  const rows = years.filter(y => (gain[y] || 0) !== 0).map(y => {
    const g = gain[y] || 0;
    const est = Math.max(0, g - CGT_DEDUCTION) * CGT_RATE;
    const payYear = String(Number(y) + 1);
    const actual = paid[payYear] || 0;
    const settled = actual > 0;
    const burden = settled ? actual : est;
    return {
      year: y, payYear, gain: g, dividend: div[y] || 0,
      est, actual, settled, burden, net: g - burden,
      rate: g > 0 ? (burden / g) * 100 : 0
    };
  });
  const totalPaid = Object.values(paid).reduce((a, b) => a + b, 0);
  const totalGain = Object.values(gain).reduce((a, b) => a + b, 0);
  return { rows, paid, paidRows, totalPaid, totalGain };
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
