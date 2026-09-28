/* ---------------- 목표 필드 ---------------- */

const GOAL_FIELD_ALIASES = {
  period: ['시기', '연도', '일정', '분기', '목표시기'],
  category: ['구분', '분류', '카테고리'],
  title: ['항목', '목표', '내용', '제목'],
  freq: ['기간', '주기'],
  amount: ['금액 or 비율', '금액/비율', '금액', '목표값', '목표 수치', '비율'],
  status: ['상태', '진행상태', '진행'],
  doneDate: ['달성한 날', '달성일'],
  memo: ['메모', '비고', '노트'],
  priority: ['우선순위']
};

/* '10,000,000' · '₩ 1,000만' · '40%' 등 → 숫자 */
function parseGoalAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const t = String(raw).trim();
  if (/%$/.test(t)) { const v = parseFloat(t.replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v; }
  let m = t.match(/^([\d.]+)\s*억/);
  if (m) return parseFloat(m[1]) * 100000000;
  m = t.match(/^([\d,.]+)\s*만/);
  if (m) return parseFloat(m[1].replace(/,/g, '')) * 10000;
  const v = parseFloat(t.replace(/[^0-9.-]/g, ''));
  return isNaN(v) ? null : v;
}

function pickGoalField(goal, key) {
  const names = GOAL_FIELD_ALIASES[key] || [];
  for (const n of names) {
    if (goal[n] !== undefined && goal[n] !== '') return goal[n];
  }
  return null;
}

function goalStatusClass(status) {
  if (!status) return '';
  const s = String(status);
  if (/(완료|달성|✅|done|complete)/i.test(s)) return 'ok';
  if (/(지연|실패|❌|미달|보류)/i.test(s)) return 'no';
  if (/(진행)/i.test(s)) return 'active';
  if (/(대기|예정)/i.test(s)) return 'pending';
  return '';
}

/* ── 목표 지표 정의 ──────────────────────────────────────────────
   시트 '목표' 탭이 [시기 | 구분 | 항목 | 기간 | 금액 or 비율 | 상태 | 달성한 날 | 메모]
   구조로 바뀌면서, 목표 문구를 정규식으로 긁는 대신 (구분 + 항목)으로 지표를 찾고
   목표값은 '금액 or 비율' 칸에서 그대로 읽는다.
   freq('월'|'연'|'')은 흐름형 지표에서 월평균/연합계 중 무엇과 비교할지를 정한다. */
const GOAL_METRIC_DEFS = [
  /* --- 자산 (스톡) --- */
  { key: 'emergency', name: '비상금 (NH-CMA)', cat: /자산|저축/, item: /비상금/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => d.emergencyFund },
  { key: 'totalAssets', name: '총자산', cat: /자산/, item: /총\s*자산|전체\s*자산/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => d.totalAssets },
  { key: 'netWorth', name: '순자산', cat: /자산/, item: /순\s*자산/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => d.totalAssets - totalDebt() },
  { key: 'investAssets', name: '투자 자산', cat: /자산/, item: /투자/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => (d.allocation || {})['투자 자산'] || 0 },
  { key: 'pensionAssets', name: '연금 자산', cat: /자산/, item: /연금/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => (d.allocation || {})['연금 자산'] || 0 },
  { key: 'savingAssets', name: '저축 자산', cat: /자산/, item: /저축/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => (d.allocation || {})['저축 자산'] || 0 },
  { key: 'debt', name: '부채 잔액', cat: /부채/, item: /./, unit: 'won', dir: 'down', type: 'cap',
    current: () => totalDebt() },
  { key: 'investPct', name: '투자 비중', cat: /자산/, item: /투자\s*비[중율]/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d) => d.totalAssets ? (((d.allocation || {})['투자 자산'] || 0) / d.totalAssets) * 100 : 0 },
  { key: 'cashPct', name: '현금 비율', cat: null, item: /현금\s*비[중율]/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d) => d.totalAssets ? (d.emergencyFund / d.totalAssets) * 100 : 0 },

  /* --- 지출 (플로우) --- */
  { key: 'fixed', name: '고정비', cat: /지출/, item: /고정비/, unit: 'won', dir: 'down', type: 'cap',
    current: (d, e, f) => f === '연' ? e.sumFixed12 : e.avgFixed12 },
  { key: 'regret', name: '아낄 수 있었던 소비', cat: /지출/, item: /후회|아낄|bad/i, unit: 'won', dir: 'down', type: 'cap',
    current: (d, e, f) => f === '연' ? e.sumRegret12 : e.avgRegret12 },
  { key: 'expense', name: '총지출', cat: /지출/, item: /지출|생활비/, unit: 'won', dir: 'down', type: 'cap',
    current: (d, e, f) => f === '연' ? e.sumExpense12 : e.avgExpense12 },

  /* --- 수입 (플로우) --- */
  { key: 'invIncome', name: '투자 수익', cat: /수입/, item: /투자\s*수익/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '월' ? e.avgInvIncome12 : e.sumInvIncome12 },
  { key: 'laborIncome', name: '근로소득', cat: /수입/, item: /근로|급여|월급/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '연' ? e.sumLabor12 : e.avgLabor12 },
  { key: 'income', name: '총수입', cat: /수입/, item: /수입/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '연' ? e.sumIncome12 : e.avgIncome12 },

  /* --- 비율·흐름 --- */
  { key: 'savingsRate', name: '저축률', cat: null, item: /저축률/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d, e) => e.savingsRate12 },
  { key: 'netSavings', name: '순저축', cat: null, item: /순\s*저축/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '연' ? e.sumNetSavings12 : e.avgNetSavings12 },
  { key: 'passivePct', name: '근로 외 수입 비중', cat: null, item: /근로\s*외|패시브|비근로/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d, e) => e.passivePct12 }
];

function findGoalMetric(category, item) {
  const c = String(category || ''), t = String(item || '');
  if (!t) return null;
  /* 항목 정규식이 더 좁은(구체적인) 정의가 앞에 오도록 배열 순서를 유지한다 */
  for (const m of GOAL_METRIC_DEFS) {
    if (m.cat && !m.cat.test(c)) continue;
    if (!m.item.test(t)) continue;
    return m;
  }
  return null;
}

/* 목표 지표에 쓰는 파생값 — 마감된 최근 12개월 기준 */
function goalMetricExtra(data, d) {
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  const fixedTrend = getFixedMonthlyTrend(data.ledger) || [];
  const f12 = fixedTrend.slice(-12).map(x => x.total);
  const cf12 = (d.cashflow || []).slice(-12);
  const exp12 = cf12.map(x => x.expense);
  const inc12 = cf12.map(x => x.income);
  const net12 = cf12.map(x => x.income - x.expense);

  const i = d.latestPivotIdx;
  const tail = (arr) => (arr || []).slice(Math.max(0, i - 11), i + 1).map(v => v || 0);
  const invInc12 = tail(data.incomeCategories && data.incomeCategories['투자 수익']);
  const labor12 = tail(data.incomeCategories && data.incomeCategories['근로소득']);

  /* 후회 소비 월별 */
  const rgByMonth = {};
  (data.ledger || []).filter(r => r.major.includes('지출') && r.regret).forEach(r => {
    const k = ledgerMonthKey(r.date);
    if (!k) return;
    rgByMonth[k] = (rgByMonth[k] || 0) + (r.amount - (r.refund || 0));
  });
  const rgKeys = Object.keys(rgByMonth).sort().slice(-12);
  const rg12 = rgKeys.map(k => rgByMonth[k]);

  const sumInc = sum(inc12), sumExp = sum(exp12), sumLabor = sum(labor12);

  return {
    latestFixed: fixedTrend.length ? fixedTrend[fixedTrend.length - 1].total : 0,
    avgFixed12: avg(f12), sumFixed12: sum(f12),
    avgExpense12: avg(exp12), sumExpense12: sumExp,
    avgIncome12: avg(inc12), sumIncome12: sumInc,
    avgLabor12: avg(labor12), sumLabor12: sumLabor,
    avgInvIncome12: avg(invInc12), sumInvIncome12: sum(invInc12),
    avgRegret12: avg(rg12), sumRegret12: sum(rg12),
    avgNetSavings12: avg(net12), sumNetSavings12: sum(net12),
    savingsRate12: sumInc > 0 ? ((sumInc - sumExp) / sumInc) * 100 : 0,
    passivePct12: sumInc > 0 ? ((sumInc - sumLabor) / sumInc) * 100 : 0
  };
}

/* 문구에서 목표값을 뽑는 구버전 폴백 ("2억" → 200000000 · "1,010만원" → 10100000 · "12.5%" → 12.5) */
function parseGoalTargetValue(title, unit) {
  const t = String(title || '');
  if (unit === 'pct') {
    const m = t.match(/([\d.]+)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }
  let m = t.match(/([\d.]+)\s*억/);
  if (m) return parseFloat(m[1]) * 100000000;
  m = t.match(/([\d,]+)\s*만/);
  if (m) return parseFloat(m[1].replace(/,/g, '')) * 10000;
  m = t.match(/([\d,]{4,})\s*원?/);
  if (m) return parseFloat(m[1].replace(/,/g, ''));
  return null;
}

/* 목표 행 하나 → 진행 상황.
   1순위: (구분+항목)으로 지표 결정 + '금액 or 비율' 칸 값이 목표
   2순위: 수동 지정 지표(state.goalMetric) / 수동 목표값(state.goalTarget)
   3순위: 항목 문구에서 숫자 추출 (구버전 호환) */
function goalProgressOf(g, d, extra) {
  if (!g) return null;
  const item = pickGoalField(g, 'title') || '';
  const category = pickGoalField(g, 'category') || '';
  const freq = (pickGoalField(g, 'freq') || '').trim();
  const forceKey = (state.goalMetric || {})[g.__row] || null;
  const manual = (state.goalTarget || {})[g.__row];

  const metric = forceKey
    ? GOAL_METRIC_DEFS.find(m => m.key === forceKey)
    : findGoalMetric(category, item);
  if (!metric) return null;

  let target = parseGoalAmount(pickGoalField(g, 'amount'));
  if (manual !== undefined && manual !== null && manual !== '' && !isNaN(Number(manual))) target = Number(manual);
  if (target === null || isNaN(target)) target = parseGoalTargetValue(item, metric.unit);
  if (target === null || isNaN(target)) return null;

  const isPct = metric.unit === 'pct';
  const current = metric.current(d, extra || {}, freq) || 0;
  const freqLabel = freq ? `${freq} 기준` : '';
  return {
    current, target, isPct,
    invert: metric.dir === 'down',
    type: metric.type, key: metric.key, dir: metric.dir,
    name: freqLabel ? `${metric.name} · ${freqLabel}` : metric.name,
    shortName: metric.name,
    freq,
    overridden: manual !== undefined && manual !== null && manual !== ''
  };
}

/* 목표값이 현재 수준과 자릿수가 어긋나면(오타 의심) 표시용 플래그 */
function goalSanityFlag(p) {
  if (!p || p.isPct || !p.current || !p.target) return null;
  const ratio = p.target / p.current;
  if (p.invert && ratio >= 3) return `목표가 현재의 ${ratio.toFixed(0)}배 — 자릿수 확인`;
  if (!p.invert && ratio > 0 && ratio <= 0.2 && p.type !== 'accumulation') return '목표가 현재보다 한참 낮아요';
  return null;
}





/* 가계부(M) 피벗 탭은 Google Sheets 병합 셀이 gviz CSV export에서
   깨져 나오는 문제가 있어(월 헤더 행이 빈 문자열로 export됨),
   parsePivotFromRows가 못 찾을 때가 있다. 이미 정상 파싱되는
   가계부(D) 일별 원장(ledger)에서 동일한 모양의 요약을 직접
   집계해서 그 자리를 대체한다. */
function buildPivotFromLedger(ledger) {
  if (!ledger || !ledger.length) return null;

  const monthOf = (dateCell) => {
    const m = dateCell.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${parseInt(m[2], 10)}월`;
  };

  const monthSet = new Set();
  ledger.forEach(r => { const mk = monthOf(r.date); if (mk) monthSet.add(mk); });
  const months = Array.from(monthSet).sort((a, b) => pivotMonthKey(a) - pivotMonthKey(b));
  if (months.length === 0) return null;
  const monthIdx = {};
  months.forEach((m, i) => { monthIdx[m] = i; });
  const zeros = () => months.map(() => 0);

  const incomeTotal = zeros(), expenseTotal = zeros();
  const expenseCategories = {}, incomeCategories = {}, transferCategories = {};

  ledger.forEach(r => {
    const mk = monthOf(r.date);
    if (!mk) return;
    const idx = monthIdx[mk];
    if (idx === undefined) return;
    const amt = r.amount || 0;
    if (r.major === '지출') {
      if (!expenseCategories[r.minor]) expenseCategories[r.minor] = zeros();
      expenseCategories[r.minor][idx] += amt;
      expenseTotal[idx] += amt;
    } else if (r.major === '수입') {
      if (!incomeCategories[r.minor]) incomeCategories[r.minor] = zeros();
      incomeCategories[r.minor][idx] += amt;
      incomeTotal[idx] += amt;
    } else if (r.major === '이체') {
      if (!transferCategories[r.minor]) transferCategories[r.minor] = zeros();
      transferCategories[r.minor][idx] += amt;
    }
  });

  return { months, incomeTotal, expenseTotal, expenseCategories, incomeCategories, transferCategories };
}



function aggregateByTag(tagRows) {
  const map = {};
  tagRows.forEach(r => {
    const tags = r.tags.length ? r.tags : ['미분류'];
    tags.forEach(t => { map[t] = (map[t] || 0) + r.total; });
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
