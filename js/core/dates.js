/* ---------------- page: 오늘 (하루 단위) ---------------- */

/* 시트의 체크 항목(Good/Bad · 고정비 · 회사 환급)을 배지로 */
const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];


function ledgerDayKey(dateStr) {
  const p = parseLedgerDateParts(dateStr);
  return p ? `${p.y}-${pad2(p.mo)}-${pad2(p.d)}` : null;
}

function shiftDayKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKeyOfDate(new Date(y, m - 1, d + delta));
}

function dowOfDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function dayKeyLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}




/* 지출 한 건의 '실지출' = 금액 − 회사 환급 */
function netExpenseOf(r) { return r.amount - (r.refund || 0); }

/* 월 지출 예산
   1순위: 목표 탭의 "(월) 지출/실지출 N만원" 목표
   2순위: 마감된 최근 3개월 실지출(환급 제외) 평균
   ※ 예산·누적 지출 모두 '환급 제외' 기준으로 통일 */
function monthlyExpenseTarget(data, ledger, monthKey) {
  const goals = data.goals || [];
  /* 예산 저장이 쓰는 목표 줄(metric_source = monthly_expense)이 먼저 — 제목 글자로는 못 찾는다 */
  for (const g of goals) {
    if (g.__metric !== 'monthly_expense' || /중단/.test(g['상태'] || '')) continue;
    const n = parseFloat(String(g['금액 or 비율'] || '').replace(/,/g, ''));
    if (n > 0) return { amount: n, source: '목표', label: g['항목'] || null };
  }
  for (const g of goals) {
    const title = pickGoalField(g, 'title');
    if (!title) continue;
    const m = String(title).match(/(?:월\s*)?(?:실)?지출\s*([\d,]+)\s*만원/);
    if (m) return { amount: parseFloat(m[1].replace(/,/g, '')) * 10000, source: '목표 탭', label: String(title).trim() };
  }
  const cur = thisMonthKey();
  const vals = [];
  for (let i = 1; i <= 3; i++) {
    const k = shiftMonthKey(monthKey, -i);
    if (k >= cur) continue;
    const sum = ledger.filter(r => ledgerMonthKey(r.date) === k && r.major.includes('지출'))
      .reduce((a, r) => a + netExpenseOf(r), 0);
    if (sum > 0) vals.push(sum);
  }
  if (!vals.length) return null;
  return { amount: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), source: '최근 3개월 실지출 평균', label: null };
}
