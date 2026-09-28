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
