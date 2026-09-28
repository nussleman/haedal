/* ---------------- page: 이번달 (월 종합) ---------------- */

function parseLedgerDateParts(s) {
  const m = (s || '').match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

function makeMonthKey(y, mo) { return `${y}-${String(mo).padStart(2, '0')}`; }

function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return makeMonthKey(dt.getFullYear(), dt.getMonth() + 1);
}

function monthKeyLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${y}년 ${m}월`;
}

function daysInMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function thisMonthKey() {
  const n = new Date();
  return makeMonthKey(n.getFullYear(), n.getMonth() + 1);
}

/* 이번 달이면 오늘 날짜, 과거 달이면 말일, 미래 달이면 0 */
function elapsedDaysOf(monthKey) {
  const cur = thisMonthKey();
  if (monthKey === cur) return new Date().getDate();
  return monthKey < cur ? daysInMonthKey(monthKey) : 0;
}

function buildNowMonth(ledger, monthKey) {
  const [y, mo] = monthKey.split('-').map(Number);
  const days = daysInMonthKey(monthKey);
  const rows = ledger.filter(r => ledgerMonthKey(r.date) === monthKey);
  const daily = [];
  for (let i = 1; i <= days; i++) {
    daily.push({ day: i, dow: new Date(y, mo - 1, i).getDay(), income: 0, expense: 0, transfer: 0, rows: [] });
  }
  rows.forEach(r => {
    const p = parseLedgerDateParts(r.date);
    if (!p) return;
    const b = daily[p.d - 1];
    if (!b) return;
    b.rows.push(r);
    if (r.major.includes('수입')) b.income += r.amount;
    else if (r.major.includes('지출')) b.expense += r.amount;
    else if (r.major.includes('이체')) b.transfer += r.amount;
  });

  const weeks = [];
  let cur = null;
  daily.forEach(b => {
    if (!cur || b.dow === 1) { cur = { idx: weeks.length, days: [] }; weeks.push(cur); }
    cur.days.push(b);
  });
  weeks.forEach(w => {
    w.income = w.days.reduce((a, b) => a + b.income, 0);
    w.expense = w.days.reduce((a, b) => a + b.expense, 0);
    w.transfer = w.days.reduce((a, b) => a + b.transfer, 0);
    w.from = w.days[0].day;
    w.to = w.days[w.days.length - 1].day;
    w.label = `${w.idx + 1}주차`;
    w.range = `${mo}/${w.from}–${mo}/${w.to}`;
    w.rows = w.days.reduce((a, b) => a.concat(b.rows), []);
  });

  const income = rows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0);
  const expense = rows.filter(r => r.major.includes('지출')).reduce((a, r) => a + r.amount, 0);
  return { monthKey, y, mo, days, daily, weeks, rows, income, expense };
}

function cumExpenseThroughDay(ledger, monthKey, dayLimit) {
  let sum = 0;
  ledger.forEach(r => {
    if (!r.major.includes('지출')) return;
    if (ledgerMonthKey(r.date) !== monthKey) return;
    const p = parseLedgerDateParts(r.date);
    if (p && p.d <= dayLimit) sum += r.amount;
  });
  return sum;
}

function cumThroughDay(ledger, monthKey, dayLimit, keyword) {
  let sum = 0;
  ledger.forEach(r => {
    if (!r.major.includes(keyword)) return;
    if (ledgerMonthKey(r.date) !== monthKey) return;
    const p = parseLedgerDateParts(r.date);
    if (p && p.d <= dayLimit) sum += r.amount;
  });
  return sum;
}

/* 최근 N개월, 같은 일자까지의 누적 평균 (수입/지출/이체 공용) */
function paceAverageOf(ledger, monthKey, dayLimit, lookback, keyword) {
  const vals = [];
  for (let i = 1; i <= lookback; i++) {
    const k = shiftMonthKey(monthKey, -i);
    const hasData = ledger.some(r => ledgerMonthKey(r.date) === k && r.major.includes(keyword));
    if (hasData) vals.push(cumThroughDay(ledger, k, dayLimit, keyword));
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/* 스탯 카드 보조줄: 기준값 대비 증감 한 줄 */
function cmpSub(cur, base, invert, label) {
  if (base === null || base === undefined || !isFinite(base) || base === 0) {
    return `<div class="sub" style="color:var(--text-faint)">${label} —</div>`;
  }
  const diff = cur - base;
  const pct = (diff / Math.abs(base)) * 100;
  const good = invert ? diff <= 0 : diff >= 0;
  const cls = diff === 0 ? '' : (good ? 'good' : 'warn');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return `<div class="sub ${cls}">${label} ${sign}${formatCompactWon(Math.abs(diff))}원 (${sign}${Math.abs(pct).toFixed(0)}%)</div>`;
}

/* 퍼센트포인트 비교 한 줄 */
function cmpSubPp(cur, base, label) {
  if (cur === null || base === null || base === undefined) {
    return `<div class="sub" style="color:var(--text-faint)">${label} —</div>`;
  }
  const diff = cur - base;
  const cls = diff === 0 ? '' : (diff > 0 ? 'good' : 'warn');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return `<div class="sub ${cls}">${label} ${sign}${Math.abs(diff).toFixed(1)}%p</div>`;
}

/* 최근 N개월, 같은 일자까지의 누적 지출 평균 (같은 페이스인지 비교용) */
function pacePeerAverage(ledger, monthKey, dayLimit, lookback) {
  const vals = [];
  for (let i = 1; i <= lookback; i++) {
    const k = shiftMonthKey(monthKey, -i);
    const hasData = ledger.some(r => ledgerMonthKey(r.date) === k && r.major.includes('지출'));
    if (hasData) vals.push(cumExpenseThroughDay(ledger, k, dayLimit));
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/* 고정비 체크리스트: 최근 3개월에 등장한 고정비 항목 대비 이번 달 결제 여부 */
function nowFixedStatus(ledger, monthKey) {
  const prevKeys = [1, 2, 3].map(i => shiftMonthKey(monthKey, -i));
  const tpl = {};
  ledger.filter(r => r.fixed && r.major.includes('지출')).forEach(r => {
    const k = ledgerMonthKey(r.date);
    if (!prevKeys.includes(k)) return;
    const id = `${r.item}|${r.vendor}`;
    if (!tpl[id]) tpl[id] = { item: r.item, vendor: r.vendor, minor: r.minor, amounts: [], months: new Set() };
    tpl[id].amounts.push(r.amount);
    tpl[id].months.add(k);
  });
  const paid = {};
  ledger.filter(r => r.fixed && r.major.includes('지출') && ledgerMonthKey(r.date) === monthKey).forEach(r => {
    const id = `${r.item}|${r.vendor}`;
    paid[id] = (paid[id] || 0) + r.amount;
    if (!tpl[id]) tpl[id] = { item: r.item, vendor: r.vendor, minor: r.minor, amounts: [r.amount], months: new Set() };
  });
  return Object.keys(tpl).map(id => {
    const t = tpl[id];
    return {
      item: t.item, vendor: t.vendor, minor: t.minor,
      expected: t.amounts.length ? Math.round(t.amounts.reduce((a, b) => a + b, 0) / t.amounts.length) : 0,
      paid: paid[id] !== undefined ? paid[id] : null,
      recur: t.months.size
    };
  }).sort((a, b) => (a.paid === null ? 0 : 1) - (b.paid === null ? 0 : 1) || b.expected - a.expected);
}

function nowCategoryRows(ledger, monthKey, scopeRows, cmpDay) {
  const prevKey = shiftMonthKey(monthKey, -1);
  const curMap = {}, prevMap = {};
  scopeRows.filter(r => r.major.includes('지출')).forEach(r => {
    curMap[r.minor || '기타'] = (curMap[r.minor || '기타'] || 0) + r.amount;
  });
  const limit = (cmpDay === null || cmpDay === undefined) ? null : cmpDay;
  if (limit !== null) {
    ledger.filter(r => r.major.includes('지출') && ledgerMonthKey(r.date) === prevKey).forEach(r => {
      const p = parseLedgerDateParts(r.date);
      if (!p || p.d > limit) return;
      prevMap[r.minor || '기타'] = (prevMap[r.minor || '기타'] || 0) + r.amount;
    });
  }
  const names = [...new Set([...Object.keys(curMap), ...Object.keys(prevMap)])];
  const total = Object.values(curMap).reduce((a, b) => a + b, 0);
  return names.map(n => ({
    name: n, cur: curMap[n] || 0, prev: prevMap[n] || 0,
    pct: total > 0 ? ((curMap[n] || 0) / total) * 100 : 0
  })).filter(r => r.cur > 0 || r.prev > 0).sort((a, b) => b.cur - a.cur);
}

function nowTransferRows(scopeRows) {
  const map = {};
  scopeRows.filter(r => r.major.includes('이체')).forEach(r => {
    const k = r.minor || '기타';
    if (!map[k]) map[k] = { name: k, total: 0, detail: {} };
    map[k].total += r.amount;
    map[k].detail[r.item || '-'] = (map[k].detail[r.item || '-'] || 0) + r.amount;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function nowDeltaSub(cur, prev, invert, note) {
  if (prev === null || prev === undefined || prev === 0) return '<div class="sub">전월 비교 데이터 없음</div>';
  const diff = cur - prev;
  const pct = (diff / Math.abs(prev)) * 100;
  const good = invert ? diff < 0 : diff > 0;
  const cls = diff === 0 ? '' : (good ? 'good' : 'warn');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return `<div class="sub ${cls}">${note || '전월 대비'} ${sign}${wonComma(diff)}원 (${sign}${Math.abs(pct).toFixed(1)}%)</div>`;
}

/* 흐름 차트 축 — 누르면 [누적(+예상) + 최근 3개월 평균 페이스]가 한 쌍으로 켜진다 */
const FLOW_AXES = [
  { key: 'income', label: '수입', color: '#4c8c6b' },
  { key: 'expense', label: '지출', color: '#c1483f' },
  { key: 'net', label: '순저축', color: '#9b7fc2' }
];
/* 수입 분류 색 — '이번달'과 '올해'가 같은 분류를 같은 색으로 그려야 눈이 헷갈리지 않는다.
   그래서 화면별로 팔레트를 돌리지 않고, 원장 전체의 수입 합계가 큰 분류부터 한 번 배정해
   두고 어디서나 그 표를 쓴다. 세부항목('근로소득 › 본봉')은 부모 분류 색을 따라간다. */
const INCOME_PALETTE = ['#4c8c6b', '#5b8cb8', '#9b7fc2', '#c9a227', '#c1857a', '#39a8bd', '#d9884f', '#8a9bb0'];

/* 수입 분류·세부항목의 순서는 금액이 아니라 '분류 표'가 정한다.
   달마다 순서가 바뀌면 같은 자리를 보던 눈이 매번 다시 읽어야 한다.
   1순위 = categories 테이블(EN.cats)의 sort_order · 못 읽었을 때를 위한 기본값을 같이 둔다.
   표에 없는데 원장에만 있는 분류는 뒤에 붙인다 — 조용히 빠뜨리지 않기 위해서. */
const INCOME_TAXONOMY_FALLBACK = [
  ['근로소득', ['월급', '월급 외', '보너스']],
  ['부수입', ['부수입']],
  ['투자 수익', ['판매수익', '배당금', '계좌 이자']],
  ['저축 수익', ['예적금 이자']],
  ['그 외', ['그 외 수입']]
];
function incomeTaxonomy(ledger) {
  const order = [];
  const push = (cat, item) => {
    if (!cat) return;
    let g = order.find(x => x.cat === cat);
    if (!g) { g = { cat, items: [] }; order.push(g); }
    if (item && g.items.indexOf(item) < 0) g.items.push(item);
  };
  const fromDb = (EN.cats || []).filter(c => c.kind === '수입')
    .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (fromDb.length) fromDb.forEach(c => push(c.category, c.subcategory));
  else INCOME_TAXONOMY_FALLBACK.forEach(([c, its]) => its.forEach(it => push(c, it)));
  (ledger || []).forEach(r => { if (r.major.includes('수입')) push(r.minor || '기타', r.item || '-'); });
  return order;
}
function incomeCatColorMap(ledger) {
  const map = {};
  incomeTaxonomy(ledger).forEach((g, i) => { map[g.cat] = INCOME_PALETTE[i % INCOME_PALETTE.length]; });
  return map;
}
function incomeCatColorOf(map, name) {
  const base = String(name || '').split(' › ')[0];
  return map[base] || INCOME_PALETTE[INCOME_PALETTE.length - 1];
}

/* 지출도 같은 규칙을 쓴다 — 순서는 금액이 아니라 '분류 표'가 정하고,
   표에 없는데 원장에만 있는 분류는 조용히 빠뜨리지 않고 뒤에 붙인다. */
const EXPENSE_PALETTE = ['#c1483f', '#d9884f', '#c9a227', '#c2749b', '#7b7fd0', '#39a8bd', '#4c8c6b', '#8a9bb0'];
const EXPENSE_TAXONOMY_FALLBACK = [
  ['식비', ['외식', '카페/디저트', '간식', '식료품']],
  ['주거', ['월세/관리비', '공과금']],
  ['교통/차량', ['대중교통', '택시', '차량']],
  ['통신', ['통신비']],
  ['생활용품', ['생활용품']],
  ['문화생활', ['공연', '영화', '취미']],
  ['패션/미용', ['의류', '미용']],
  ['건강', ['병원', '약국', '운동']],
  ['교육', ['교육']],
  ['경조사/회비', ['경조사', '회비']],
  ['기타', ['구독', '그 외 지출']]
];
function expenseTaxonomy(ledger) {
  const order = [];
  const push = (cat, item) => {
    if (!cat) return;
    let g = order.find(x => x.cat === cat);
    if (!g) { g = { cat, items: [] }; order.push(g); }
    if (item && g.items.indexOf(item) < 0) g.items.push(item);
  };
  const fromDb = (EN.cats || []).filter(c => c.kind === '지출')
    .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (fromDb.length) fromDb.forEach(c => push(c.category, c.subcategory));
  else EXPENSE_TAXONOMY_FALLBACK.forEach(([c, its]) => its.forEach(it => push(c, it)));
  (ledger || []).forEach(r => { if (r.major.includes('지출')) push(r.minor || '기타', r.item || '-'); });
  return order;
}
function expenseCatColorMap(ledger) {
  const map = {};
  expenseTaxonomy(ledger).forEach((g, i) => { map[g.cat] = EXPENSE_PALETTE[i % EXPENSE_PALETTE.length]; });
  return map;
}
function expenseCatColorOf(map, name) {
  const base = String(name || '').split(' › ')[0];
  return map[base] || EXPENSE_PALETTE[EXPENSE_PALETTE.length - 1];
}

function hexToRgba(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const NOW_OPTS = [
  { key: 'budget', label: '예산 페이스', color: '#c9a227' },
  { key: 'daily', label: '일별 지출', color: 'rgba(193,72,63,.45)' }
];

function renderNowPage(container, data, d) {
  const ledger = data.ledger || [];
  if (!ledger.length) {
    container.innerHTML = '<div class="panel full"><div class="empty-state">가계부(D) 데이터를 불러오지 못해 이번 달을 계산할 수 없어요.</div></div>';
    return;
  }

  const availableKeys = [...new Set(ledger.map(r => ledgerMonthKey(r.date)).filter(Boolean))].sort();
  /* 사람이 직접 고른 달만 붙잡아 둔다. 그러지 않으면 첫 화면을 스냅샷(옛 원장)으로 그릴 때
     그 원장의 마지막 달에 고정돼, 실데이터가 온 뒤에도 엉뚱한 달이 남는다. */
  if (!state.nowMonthPinned || !availableKeys.includes(state.nowMonthKey)) {
    const t = thisMonthKey();
    state.nowMonthKey = availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1];
  }
  const monthKey = state.nowMonthKey;
  const M = buildNowMonth(ledger, monthKey);

  const isThisMonth = monthKey === thisMonthKey();
  const elapsed = Math.max(elapsedDaysOf(monthKey), 0);
  const progressPct = M.days ? Math.min((elapsed / M.days) * 100, 100) : 0;

  const week = (state.nowWeekIdx !== null && M.weeks[state.nowWeekIdx]) ? M.weeks[state.nowWeekIdx] : null;
  const scopeRows = week ? week.rows : M.rows;
  const scopeLabel = week ? `${monthKeyLabel(monthKey)} ${week.label} (${week.range})` : monthKeyLabel(monthKey);

  const sIncome = scopeRows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0);
  const sExpense = scopeRows.filter(r => r.major.includes('지출')).reduce((a, r) => a + r.amount, 0);
  const sNet = sIncome - sExpense;
  const sRate = sIncome > 0 ? (sNet / sIncome) * 100 : null;

  const prevKey = shiftMonthKey(monthKey, -1);
  const cmpDay = isThisMonth ? elapsed : daysInMonthKey(prevKey);
  const cmpRange = isThisMonth ? `${Number(prevKey.split('-')[1])}/1–${cmpDay}` : monthKeyLabel(prevKey);
  const cmpNote = isThisMonth ? `전월 ${cmpRange} 대비` : '전월 대비';
  const prevIncomeSame = week ? null : cumThroughDay(ledger, prevKey, cmpDay, '수입');
  const prevExpenseSame = week ? null : cumThroughDay(ledger, prevKey, cmpDay, '지출');

  /* --- 비교 기준: 전월 동일시점 / 최근 3개월 동일시점 평균 / 목표 --- */
  const prevNetSame = (prevIncomeSame === null || prevExpenseSame === null) ? null : prevIncomeSame - prevExpenseSame;
  const prevRateSame = (prevIncomeSame && prevIncomeSame > 0) ? ((prevIncomeSame - prevExpenseSame) / prevIncomeSame) * 100 : null;
  const avgDay = isThisMonth ? (elapsed || M.days) : M.days;
  const avgIncome = week ? null : paceAverageOf(ledger, monthKey, avgDay, 3, '수입');
  const avgExpense = week ? null : paceAverageOf(ledger, monthKey, avgDay, 3, '지출');
  const avgNet = (avgIncome === null || avgExpense === null) ? null : avgIncome - avgExpense;
  const avgRate = (avgIncome && avgIncome > 0) ? ((avgIncome - avgExpense) / avgIncome) * 100 : null;
  const rateTarget = state.goals.savingsRateTarget;
  const netTarget = sIncome > 0 ? sIncome * (rateTarget / 100) : null;
  const avgNote = isThisMonth ? '최근 3개월 같은 시점 평균 대비' : '최근 3개월 평균 대비';

  const peerAvg = pacePeerAverage(ledger, monthKey, elapsed || M.days, 3);
  const paceDiff = peerAvg !== null ? M.expense - peerAvg : null;
  const projected = (isThisMonth && elapsed > 0) ? Math.round(M.expense / elapsed * M.days) : null;

  const fixedRows = nowFixedStatus(ledger, monthKey);
  const fixedPending = fixedRows.filter(f => f.paid === null);
  const fixedPendingSum = fixedPending.reduce((a, f) => a + f.expected, 0);
  const fixedPaidSum = fixedRows.filter(f => f.paid !== null).reduce((a, f) => a + f.paid, 0);

  const catRows = nowCategoryRows(ledger, monthKey, scopeRows, week ? null : cmpDay);
  const transferRows = nowTransferRows(scopeRows);
  const transferTotal = transferRows.reduce((a, t) => a + t.total, 0);
  const topExpenses = scopeRows.filter(r => r.major.includes('지출')).sort((a, b) => b.amount - a.amount).slice(0, 8);

  const monthOptions = availableKeys.slice().reverse().map(k => `<option value="${k}" ${k === monthKey ? 'selected' : ''}>${monthKeyLabel(k)}</option>`).join('');

  /* --- 투자원금 이체 (➡️이체 › 📈투자 자산) --- */
  const isInvTr = (r) => r.major.includes('이체') && String(r.minor || '').includes('투자');
  const investTr = scopeRows.filter(isInvTr).reduce((a, r) => a + r.amount, 0);
  const prevInvestSame = week ? null : ledger.filter(r => isInvTr(r) && ledgerMonthKey(r.date) === prevKey)
    .reduce((a, r) => { const pp = parseLedgerDateParts(r.date); return (pp && pp.d <= cmpDay) ? a + r.amount : a; }, 0);
  const investRate = sIncome > 0 ? (investTr / sIncome) * 100 : null;

  /* --- 수입 분해 (이번달 스코프) --- */
  const incBy = (kw) => scopeRows.filter(r => r.major.includes('수입') && String(r.minor || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
  const incWork = incBy('근로');
  const incInvest = incBy('투자');
  const incSide = incBy('부수입');
  const incEtc = sIncome - incWork - incInvest - incSide;
  const incCatRows = (() => {
    const curMap = {}, prevMap = {};
    scopeRows.filter(r => r.major.includes('수입')).forEach(r => {
      const k = r.minor || '기타'; curMap[k] = (curMap[k] || 0) + r.amount;
    });
    if (!week) ledger.filter(r => r.major.includes('수입') && ledgerMonthKey(r.date) === prevKey).forEach(r => {
      const pp = parseLedgerDateParts(r.date); if (!pp || pp.d > cmpDay) return;
      const k = r.minor || '기타'; prevMap[k] = (prevMap[k] || 0) + r.amount;
    });
    const names = [...new Set([...Object.keys(curMap), ...Object.keys(prevMap)])];
    const tot = Object.values(curMap).reduce((a, b) => a + b, 0);
    return names.map(n => ({ name: n, cur: curMap[n] || 0, prev: prevMap[n] || 0, pct: tot > 0 ? ((curMap[n] || 0) / tot) * 100 : 0 }))
      .filter(r => r.cur > 0 || r.prev > 0).sort((a, b) => b.cur - a.cur);
  })();
  const topIncomes = scopeRows.filter(r => r.major.includes('수입')).sort((a, b) => b.amount - a.amount).slice(0, 8);

  /* --- 수입 ---------------------------------------------------------------
     기준은 하나로 고정한다: 이 달 직전 12개월 중 '기록이 있는 달'의 월평균.
     (기록이 없는 달까지 분모에 넣으면 평균이 실제보다 낮게 나와 자기 위안이 된다.)
     분류·세부항목은 금액이 아니라 분류 표 순서로 세우고, 이번 달 금액이 0이어도 자리를 지킨다. */
  const incCatOf = (r) => r.minor || '기타';
  const incItemOf = (r) => r.item || '-';
  const incItemKeyOf = (r) => incCatOf(r) + ' › ' + incItemOf(r);
  const incTaxonomy = incomeTaxonomy(ledger);
  const incCmap = incomeCatColorMap(ledger);
  const incColorOf = (name) => incomeCatColorOf(incCmap, name);

  const incStats = (() => {
    const isInc = (r) => r.major.includes('수입');
    const cur = {}, base = {};
    const curRows = scopeRows.filter(isInc);
    curRows.forEach(r => {
      cur[incCatOf(r)] = (cur[incCatOf(r)] || 0) + r.amount;
      cur[incItemKeyOf(r)] = (cur[incItemKeyOf(r)] || 0) + r.amount;
    });
    const keys = [];
    for (let i = 1; i <= 12; i++) keys.push(shiftMonthKey(monthKey, -i));
    const active = keys.filter(k => ledger.some(r => ledgerMonthKey(r.date) === k));
    const n = active.length;
    const baseRows = ledger.filter(r => isInc(r) && active.includes(ledgerMonthKey(r.date)));
    baseRows.forEach(r => {
      base[incCatOf(r)] = (base[incCatOf(r)] || 0) + r.amount;
      base[incItemKeyOf(r)] = (base[incItemKeyOf(r)] || 0) + r.amount;
    });
    const curTot = curRows.reduce((a, r) => a + r.amount, 0);
    const avgTot = n ? baseRows.reduce((a, r) => a + r.amount, 0) / n : 0;
    const of = (k) => {
      const c = cur[k] || 0;
      const a = n ? (base[k] || 0) / n : 0;
      return {
        cur: c, avg: a, diff: c - a,
        ratio: a > 0 ? (c / a) * 100 : null,
        share: curTot > 0 ? (c / curTot) * 100 : 0,
        avgShare: avgTot > 0 ? (a / avgTot) * 100 : 0
      };
    };
    return { of, curTot, avgTot, months: n };
  })();

  /* 차트 줄 — 분류(level 1) · 펼친 분류의 세부항목(level 2).
     합계는 차트에서 뺐다. 위(지표 카드)가 이미 합계를 말하고 있고, 막대 안에 합계가 끼면
     "분류끼리 견주는 그림"이 흐려진다. */
  const incBuildRows = (openCat) => {
    const out = [];
    incTaxonomy.forEach((g, gi) => {
      const open = openCat === g.cat;
      out.push(Object.assign({}, incStats.of(g.cat), {
        label: (open ? '▾ ' : '▸ ') + g.cat, level: 1, sel: g.cat, cat: g.cat,
        color: incColorOf(g.cat), first: gi === 0
      }));
      if (!open) return;
      g.items.forEach(it => {
        const k = g.cat + ' › ' + it;
        out.push(Object.assign({}, incStats.of(k), {
          label: '     ' + it, level: 2, sel: k, cat: g.cat, color: incColorOf(g.cat), first: false
        }));
      });
    });
    return out.map(r => Object.assign(r, { avg: Math.round(r.avg) }));
  };

  const incDayNo = (r) => { const p = parseLedgerDateParts(r.date); return p ? p.d : 0; };
  const incRawRowsFor = (sel) => scopeRows.filter(r => r.major.includes('수입'))
    .filter(r => !sel || (sel.includes(' › ') ? incItemKeyOf(r) === sel : incCatOf(r) === sel))
    .sort((a, b) => incDayNo(b) - incDayNo(a) || b.amount - a.amount);

  /* --- 비상금 이체 --- */
  const isEmgTr = (r) => r.major.includes('이체') && String(r.minor || '').includes('비상금');
  const emgTr = scopeRows.filter(isEmgTr).reduce((a, r) => a + r.amount, 0);
  const prevEmgSame = week ? null : ledger.filter(r => isEmgTr(r) && ledgerMonthKey(r.date) === prevKey)
    .reduce((a, r) => { const pp = parseLedgerDateParts(r.date); return (pp && pp.d <= cmpDay) ? a + r.amount : a; }, 0);

  /* --- 지출 분해 (고정비 / 변동비 / Good·Bad) --- */
  const expRows = scopeRows.filter(r => r.major.includes('지출'));
  const netOfR = (r) => r.amount - (r.refund || 0);
  const projRate = (isThisMonth && elapsed > 0) ? (M.days / elapsed) : 1;
  const expFixed = expRows.filter(r => r.fixed).reduce((a, r) => a + netOfR(r), 0);
  const expRegret = expRows.filter(r => r.regret).reduce((a, r) => a + netOfR(r), 0);
  const expGood = expRows.filter(r => r.good).reduce((a, r) => a + netOfR(r), 0);
  /* 지출 탭 안에서는 전부 환불 뺀 금액으로 센다 — 같은 화면의 두 숫자가 서로 다르면 안 되니까 */
  const expNet = expRows.reduce((a, r) => a + netOfR(r), 0);
  const expVar = expNet - expFixed;
  const EXP_BUCKETS = [
    { key: 'all', label: '지출 합계', value: expNet, color: 'var(--expense-text)' },
    { key: 'fixed', label: '고정비', value: expFixed, color: 'var(--text)' },
    { key: 'var', label: '변동비', value: expVar, color: 'var(--text)' },
    { key: 'good', label: '잘한소비', value: expGood, color: '#7fc0a0' },
    { key: 'regret', label: '아낄 수 있었던', value: expRegret, color: '#e6b48f' }
  ];
  const EXPF = ['all', 'fixed', 'var', 'good', 'regret'].includes(state.nowExpFilter) ? state.nowExpFilter : 'all';
  const expFilterFn = { all: () => true, fixed: (r) => r.fixed, var: (r) => !r.fixed, good: (r) => r.good, regret: (r) => r.regret }[EXPF];

  /* --- 지출 ---------------------------------------------------------------
     수입 탭과 같은 눈으로 본다: 이 달 직전 12개월 중 '기록이 있는 달'의 월평균을 기준선으로
     깔고, 분류·세부항목은 금액이 아니라 분류 표 순서로 세운다. 고정비/변동비/잘한소비/
     아낀 소비 필터는 차트·카드·내역에 함께 걸린다 — 셋이 다른 숫자를 말하면 안 되니까. */
  const expCatOf = (r) => r.minor || '기타';
  const expItemOf = (r) => r.item || '-';
  const expItemKeyOf = (r) => expCatOf(r) + ' › ' + expItemOf(r);
  const expTaxonomy = expenseTaxonomy(ledger);
  const expCmap = expenseCatColorMap(ledger);
  const expColorOf = (name) => expenseCatColorOf(expCmap, name);

  const expStats = (() => {
    const isExp = (r) => r.major.includes('지출');
    const cur = {}, base = {};
    const curRows = expRows.filter(expFilterFn);
    curRows.forEach(r => {
      const v = netOfR(r);
      cur[expCatOf(r)] = (cur[expCatOf(r)] || 0) + v;
      cur[expItemKeyOf(r)] = (cur[expItemKeyOf(r)] || 0) + v;
    });
    const keys = [];
    for (let i = 1; i <= 12; i++) keys.push(shiftMonthKey(monthKey, -i));
    const active = keys.filter(k => ledger.some(r => ledgerMonthKey(r.date) === k));
    const n = active.length;
    const baseRows = ledger.filter(r => isExp(r) && expFilterFn(r) && active.includes(ledgerMonthKey(r.date)));
    baseRows.forEach(r => {
      const v = netOfR(r);
      base[expCatOf(r)] = (base[expCatOf(r)] || 0) + v;
      base[expItemKeyOf(r)] = (base[expItemKeyOf(r)] || 0) + v;
    });
    const curTot = curRows.reduce((a, r) => a + netOfR(r), 0);
    const avgTot = n ? baseRows.reduce((a, r) => a + netOfR(r), 0) / n : 0;
    const of = (k) => {
      const c = cur[k] || 0;
      const a = n ? (base[k] || 0) / n : 0;
      return {
        cur: c, avg: a, diff: c - a,
        ratio: a > 0 ? (c / a) * 100 : null,
        share: curTot > 0 ? (c / curTot) * 100 : 0,
        avgShare: avgTot > 0 ? (a / avgTot) * 100 : 0
      };
    };
    return { of, curTot, avgTot, months: n };
  })();

  const expBuildRows = (openCat) => {
    const out = [];
    expTaxonomy.forEach((g, gi) => {
      const open = openCat === g.cat;
      out.push(Object.assign({}, expStats.of(g.cat), {
        label: (open ? '▾ ' : '▸ ') + g.cat, level: 1, sel: g.cat, cat: g.cat,
        color: expColorOf(g.cat), first: gi === 0
      }));
      if (!open) return;
      g.items.forEach(it => {
        const k = g.cat + ' › ' + it;
        out.push(Object.assign({}, expStats.of(k), {
          label: '     ' + it, level: 2, sel: k, cat: g.cat, color: expColorOf(g.cat), first: false
        }));
      });
    });
    return out.map(r => Object.assign(r, { avg: Math.round(r.avg) }));
  };

  const expDayNo = (r) => { const p = parseLedgerDateParts(r.date); return p ? p.d : 0; };
  const expRawRowsFor = (sel) => expRows.filter(expFilterFn)
    .filter(r => !sel || (sel.includes(' › ') ? expItemKeyOf(r) === sel : expCatOf(r) === sel))
    .sort((a, b) => expDayNo(b) - expDayNo(a) || netOfR(b) - netOfR(a));

  /* ================= 월간 요약 재구성 =================
     대시보드는 "얼마였나"에 답하고, 리포트는 "무엇이 달랐고 다음에 뭘 할까"에 답한다.
     아래 네 덩이가 그 차이를 만든다: 한 줄 판정 · 변동 요인 · 고정/변동 분해 · 다음 액션. */

  /* --- 순자산 증감: 현금흐름만 보면 '저축했는데 자산은 줄어든 달'을 놓친다 --- */
  const nwKeyOf = (mk) => { const [y, m] = String(mk).split('-'); return `${String(y).slice(2)}년 ${m}월`; };
  const nwCur = d.byMonth ? d.byMonth[nwKeyOf(monthKey)] : undefined;
  const nwPrev = d.byMonth ? d.byMonth[nwKeyOf(prevKey)] : undefined;
  const nwDelta = (nwCur === undefined || nwPrev === undefined) ? null : nwCur - nwPrev;
  /* 순저축과 순자산 증감의 차 = 투자 평가손익 등 '내가 넣지 않았는데 움직인 몫' */
  const nwMarket = nwDelta === null ? null : nwDelta - sNet;

  /* --- 변동 요인: 전월 같은 시점과 견준다 (진행 중인 달은 D+N 까지만) --- */
  const drvLimit = week ? null : cmpDay;
  const drvCatOf = (r) => r.minor || '기타';
  const drvPrevRows = (week || drvLimit === null) ? [] :
    ledger.filter(r => r.major.includes('지출') && ledgerMonthKey(r.date) === prevKey
      && (() => { const pp = parseLedgerDateParts(r.date); return pp && pp.d <= drvLimit; })());
  const drivers = (() => {
    if (week || drvLimit === null) return [];
    const cur = {}, prv = {};
    scopeRows.filter(r => r.major.includes('지출')).forEach(r => {
      const k = drvCatOf(r); cur[k] = (cur[k] || 0) + netOfR(r);
    });
    drvPrevRows.forEach(r => { const k = drvCatOf(r); prv[k] = (prv[k] || 0) + netOfR(r); });
    return [...new Set([...Object.keys(cur), ...Object.keys(prv)])]
      .map(k => ({ name: k, cur: cur[k] || 0, prev: prv[k] || 0, diff: (cur[k] || 0) - (prv[k] || 0) }))
      .filter(x => Math.abs(x.diff) >= 1000)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5);
  })();
  /* 분류가 왜 움직였는지는 결국 가게 이름에 있다 — 한 단계 더 파서 같이 보여준다 */
  const drvWhy = (catName) => {
    const cur = {}, prv = {};
    scopeRows.filter(r => r.major.includes('지출') && drvCatOf(r) === catName)
      .forEach(r => { const v = r.vendor || r.item || '-'; cur[v] = (cur[v] || 0) + netOfR(r); });
    drvPrevRows.filter(r => drvCatOf(r) === catName)
      .forEach(r => { const v = r.vendor || r.item || '-'; prv[v] = (prv[v] || 0) + netOfR(r); });
    return [...new Set([...Object.keys(cur), ...Object.keys(prv)])]
      .map(v => ({ name: v, diff: (cur[v] || 0) - (prv[v] || 0) }))
      .filter(x => Math.abs(x.diff) >= 1000)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 2);
  };
  const drvUp = drivers.filter(x => x.diff > 0)[0] || null;
  const drvDown = drivers.filter(x => x.diff < 0)[0] || null;

  /* --- 한 줄 판정: 저축률을 목표에 견줘 한 마디로 끝낸다 --- */
  const verdict = (() => {
    if (sRate === null) return { tone: 'none', badge: '판단 보류', line: '이 달 수입 기록이 없어 저축률을 낼 수 없습니다.' };
    const gap = sRate - rateTarget;
    const tone = gap >= 0 ? 'good' : gap >= -rateTarget * 0.3 ? 'ok' : 'warn';
    const badge = gap >= 0 ? '목표 달성' : gap >= -rateTarget * 0.3 ? '목표 근처' : '목표 미달';
    const head = `${isThisMonth ? `지금까지(D+${elapsed}/${M.days}일) ` : ''}저축률 ${sRate.toFixed(1)}%`
      + ` — 목표 ${rateTarget}% ${gap >= 0 ? `+${gap.toFixed(1)}%p` : `${gap.toFixed(1)}%p`}`;
    const tail = drvUp ? ` 지난달 같은 시점보다 가장 많이 늘어난 건 ${drvUp.name} +${formatKrw(drvUp.diff)}입니다.`
      : drvDown ? ` 지난달 같은 시점보다 ${drvDown.name}에서 ${formatKrw(-drvDown.diff)} 덜 썼습니다.`
      : '';
    return { tone, badge, line: head + '.' + tail };
  })();

  /* --- 다음 달 한 가지 액션: 가장 크게 움직인 것 하나만 짚는다 --- */
  const nextAction = (() => {
    if (drvUp && drvUp.prev > 0)
      return `${drvUp.name}를 지난달 수준(${formatKrw(drvUp.prev)})으로 되돌리면 순저축이 ${formatKrw(drvUp.diff)} 늘어납니다.`;
    if (drvUp)
      return `${drvUp.name}는 지난달엔 없던 지출입니다 — 이번 한 번인지, 앞으로도 나갈 돈인지 정해두세요.`;
    if (expRegret > 0)
      return `아낄 수 있었던 소비 ${formatKrw(expRegret)} — 지출의 ${expNet > 0 ? ((expRegret / expNet) * 100).toFixed(0) : 0}%입니다. 여기서 한 건만 줄여보세요.`;
    if (sRate !== null && sRate < rateTarget && expVar > 0)
      return `목표까지 ${formatKrw(Math.max(0, (netTarget || 0) - sNet))} 남았습니다. 변동비 ${formatKrw(expVar)} 안에서 찾는 게 가장 빠릅니다.`;
    return '이번 달은 특별히 손댈 곳이 보이지 않습니다. 이대로 유지하세요.';
  })();

  /* --- 후회한 소비 상위 --- */
  const regretTop = expRows.filter(r => r.regret)
    .sort((a, b) => netOfR(b) - netOfR(a)).slice(0, 3);

  /* --- 페이스 차트: 진행 중인 달이면 위, 마감된 달이면 아래로 --- */
  const pacePanel = `
    <div class="g">
      <div class="panel s12">
        <div class="panel-title">
          <div>페이스 차트<span class="pace-tag" id="now-pace-tag"></span></div>
          <span class="ptag">${isThisMonth ? `D+${elapsed} / ${M.days}일` : `${M.days}일 · 마감`}</span>
        </div>
        <div class="axis-bar">
          <div class="axis-btns" id="now-axis-btns">
            ${FLOW_AXES.map(a => `<button data-axis="${a.key}" class="axis-btn ${state.nowAxis === a.key ? 'on' : ''}" style="--ac:${a.color}">
              <i></i>${a.label}
            </button>`).join('')}
          </div>
          <div class="series-toggles" id="now-series-toggles" style="margin-bottom:0;${state.nowAxis === 'expense' ? '' : 'display:none;'}">
            ${NOW_OPTS.map(sr => `<label class="series-chk ${state.nowOpts[sr.key] ? 'on' : ''}">
              <input type="checkbox" data-key="${sr.key}" ${state.nowOpts[sr.key] ? 'checked' : ''} />
              <i style="background:${sr.color}"></i>${sr.label}
            </label>`).join('')}
          </div>
        </div>
        <div class="chart-legend" id="now-flow-legend" style="margin-bottom:6px;"></div>
        <div class="chart-wrap tall" style="min-height:320px;"><canvas id="chart-now-flow"></canvas></div>
        <div class="now-progress" style="margin-top:10px;">
          <div class="now-progress-track"><div class="now-progress-fill" style="width:${progressPct}%"></div></div>
          <span class="now-progress-text">${isThisMonth ? `D+${elapsed} / ${M.days}일 · 남은 ${M.days - elapsed}일` : `${M.days}일 · 마감`}</span>
        </div>
      </div>
    </div>`;

  const barPct = (v) => (expNet > 0 ? Math.max(0, (v / expNet) * 100) : 0);

  const NOW_SUBS =[['summary', '요약'], ['income', '수입'], ['expense', '지출']];
  const NSUB_MIGRATE = { budget: 'expense', detail: 'expense', saving: 'summary' };
  if (NSUB_MIGRATE[state.nowSub]) state.nowSub = NSUB_MIGRATE[state.nowSub];
  const NSUB = NOW_SUBS.some(x => x[0] === state.nowSub) ? state.nowSub : 'summary';

  container.innerHTML = `
    <div class="page-daybar">
      <div class="today-datewrap">
        <div class="day-title">${scopeLabel}</div>
        <div class="month-nav">
          <button id="now-prev" ${availableKeys.indexOf(monthKey) <= 0 ? 'disabled' : ''}>◀</button>
          <select id="now-month-select">${monthOptions}</select>
          <button id="now-next" ${availableKeys.indexOf(monthKey) >= availableKeys.length - 1 ? 'disabled' : ''}>▶</button>
          <button class="btn small" id="now-thismonth">이번 달</button>
        </div>
      </div>
    </div>

    <div class="subnav sub2" id="now-subnav">${NOW_SUBS.map(([v, l]) =>
      `<button data-sub="${v}" class="${v === NSUB ? 'active' : ''}">${l}</button>`).join('')}</div>

    ${NSUB === 'summary' ? `
    <div class="nw-verdict ${verdict.tone}">
      <div class="nw-vhead">
        <span class="nw-badge">${verdict.badge}</span>
        <span class="nw-vline">${verdict.line}</span>
      </div>
      <div class="nw-vfig">
        <button class="nw-fig" data-goto="income"><span>수입</span><b style="color:var(--income-text)">${formatKrw(sIncome)}</b></button>
        <span class="nw-op">−</span>
        <button class="nw-fig" data-goto="expense"><span>지출</span><b style="color:var(--expense-text)">${formatKrw(sExpense)}</b></button>
        <span class="nw-op">=</span>
        <span class="nw-fig flat"><span>순저축</span><b style="color:${sNet >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatKrw(sNet)}</b></span>
        ${projected === null ? '' : `<span class="nw-proj">월말 예상 지출 <b>${formatKrw(projected + fixedPendingSum)}</b></span>`}
      </div>
    </div>

    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));">
      <div class="stat-card">
        <div class="label">순저축</div>
        <div class="value" style="color:${sNet >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatKrw(sNet)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : cmpSub(sNet, avgNet, false, avgNote)}
        <div class="sub dimline">투자 <b>${formatCompactWon(investTr)}</b> · 비상금 <b>${formatCompactWon(emgTr)}</b></div>
      </div>
      <div class="stat-card">
        <div class="label">저축률</div>
        <div class="value" style="color:${sRate === null ? 'var(--text)' : sRate >= rateTarget ? 'var(--net-text)' : 'var(--expense-text)'}">${sRate === null ? '—' : sRate.toFixed(1) + '%'}</div>
        ${cmpSubPp(sRate, rateTarget, `목표 ${rateTarget}% 대비`)}
        ${netTarget === null ? '' : `<div class="sub dimline">목표 금액 <b>${formatCompactWon(Math.round(netTarget))}</b></div>`}
      </div>
      <div class="stat-card clickable" data-goto="expense" title="지출 탭으로 이동">
        <div class="label">변동비 <i class="nw-hint" title="고정비를 뺀, 이번 달에 내가 손댈 수 있었던 몫">?</i></div>
        <div class="value" style="color:var(--expense-text)">${formatKrw(expVar)}</div>
        <div class="sub">지출의 <b>${expNet > 0 ? ((expVar / expNet) * 100).toFixed(0) : 0}%</b> · 고정비 ${formatCompactWon(expFixed)}</div>
        ${fixedPendingSum > 0 ? `<div class="sub dimline">미결 고정비 <b>${formatCompactWon(fixedPendingSum)}</b> 남음</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="label">순자산 증감</div>
        <div class="value" style="color:${nwDelta === null ? 'var(--text)' : nwDelta >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${nwDelta === null ? '—' : (nwDelta >= 0 ? '+' : '') + formatCompactWon(nwDelta) + '원'}</div>
        ${nwDelta === null
          ? '<div class="sub">자산 스냅샷이 아직 없는 달입니다</div>'
          : `<div class="sub ${nwMarket >= 0 ? 'good' : 'warn'}">넣은 돈 ${formatCompactWon(sNet)} · 시장이 움직인 몫 ${nwMarket >= 0 ? '+' : ''}${formatCompactWon(nwMarket)}</div>`}
      </div>
    </div>

    ${isThisMonth ? pacePanel : ''}

    <div class="g">
      <div class="panel s7">
        <div class="panel-title">
          <div>무엇이 달랐나<span class="p-note">지출 변동 TOP 5</span></div>
          <span class="ptag">${week ? '주간에는 비교하지 않습니다' : cmpNote}</span>
        </div>
        ${drivers.length ? `<div class="nw-drv">${drivers.map(x => {
          const why = drvWhy(x.name);
          const up = x.diff > 0;
          const mag = Math.abs(x.diff);
          const max = Math.abs(drivers[0].diff) || 1;
          return `<div class="nw-drvrow ${up ? 'up' : 'dn'}" data-drv="${enEsc(x.name)}">
            <span class="nm">${enEsc(x.name)}</span>
            <span class="bar"><i style="width:${Math.max(3, (mag / max) * 100)}%"></i></span>
            <span class="df">${up ? '+' : '−'}${formatKrw(mag)}</span>
            <span class="pv">${formatCompactWon(x.prev)} → ${formatCompactWon(x.cur)}</span>
            ${why.length ? `<span class="wy">${why.map(w =>
              `${enEsc(w.name)} ${w.diff > 0 ? '+' : '−'}${formatCompactWon(Math.abs(w.diff))}`).join(' · ')}</span>` : '<span class="wy"></span>'}
          </div>`;
        }).join('')}</div>`
        : `<div class="empty-state">${week ? '주차를 해제하면 전월 같은 시점과 견줍니다.' : '전월과 견줄 만큼 달라진 분류가 없습니다.'}</div>`}
      </div>

      <div class="panel s5">
        <div class="panel-title"><div>고정비와 변동비</div><span class="ptag">${formatCompactWon(expNet)}원</span></div>
        <div class="nw-split">
          <div class="nw-splitbar">
            <i class="fx" style="width:${barPct(expFixed)}%" title="고정비 ${formatKrw(expFixed)}"></i>
            <i class="vr" style="width:${barPct(expVar)}%" title="변동비 ${formatKrw(expVar)}"></i>
          </div>
          <div class="nw-splitleg">
            <span><i class="fx"></i>고정비 <b>${formatKrw(expFixed)}</b> (${expNet > 0 ? ((expFixed / expNet) * 100).toFixed(0) : 0}%)</span>
            <span><i class="vr"></i>변동비 <b>${formatKrw(expVar)}</b> (${expNet > 0 ? ((expVar / expNet) * 100).toFixed(0) : 0}%)</span>
          </div>
          <p class="nw-splitnote">고정비는 계약을 바꿔야 줄고, 변동비는 이번 주에도 줄일 수 있습니다.
            ${fixedPending.length ? `아직 안 나간 고정비가 <b>${fixedPending.length}건</b> 있습니다.` : ''}</p>
        </div>
      </div>
    </div>

    <div class="g">
      <div class="panel s7">
        <div class="panel-title"><div>잘한 소비 · 아낄 수 있었던 소비</div>
          <span class="ptag">기록할 때 찍은 GOOD/BAD</span></div>
        ${(expGood || expRegret) ? `
        <div class="nw-gb">
          <div class="nw-gbcell good">
            <span class="k">잘한 소비</span>
            <b>${formatKrw(expGood)}</b>
            <span class="s">지출의 ${expNet > 0 ? ((expGood / expNet) * 100).toFixed(0) : 0}%</span>
          </div>
          <div class="nw-gbcell bad">
            <span class="k">아낄 수 있었던</span>
            <b>${formatKrw(expRegret)}</b>
            <span class="s">지출의 ${expNet > 0 ? ((expRegret / expNet) * 100).toFixed(0) : 0}%</span>
          </div>
        </div>
        ${regretTop.length ? `<div class="nw-rtop">${regretTop.map(r =>
          `<div><span class="n">${enEsc(r.vendor || r.item || '-')}</span>
            <span class="c">${enEsc(r.minor || '')}</span>
            <b>${formatKrw(netOfR(r))}</b></div>`).join('')}</div>` : ''}`
        : '<div class="empty-state">이 달에는 GOOD/BAD를 찍은 기록이 없습니다.</div>'}
      </div>
      <div class="panel s5 nw-actpanel">
        <div class="panel-title"><div>다음 달 한 가지</div></div>
        <p class="nw-act">${nextAction}</p>
      </div>
    </div>

    ${isThisMonth ? '' : pacePanel}` : ''}

    ${NSUB === 'income' ? `
    <div class="inc-scope" id="now-inc-scope"></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:12px;" id="now-inc-stats"></div>

    <div class="g inc-g">
      <div class="panel s7 inc-chart-panel">
        <div class="panel-title">
          <div>차트</div>
          <div class="inc-legend">
            <span><i class="inc-sw solid"></i>이번 달</span>
            <span><i class="inc-sw hollow"></i>지난 ${incStats.months || 0}개월 월평균</span>
          </div>
        </div>
        <div class="chart-wrap inc-chart-wrap" id="now-inc-chartwrap"><canvas id="chart-now-income"></canvas></div>
      </div>

      <div class="panel s5 inc-list-panel">
        <div class="panel-title">
          <div>내역</div>
          <span class="ptag" id="now-inc-ptag"></span>
        </div>
        <div id="now-incright-body"></div>
      </div>
    </div>` : ''}

    ${NSUB === 'expense' ? `
    <div class="inc-scope" id="now-exp-scope"></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:12px;" id="now-exp-stats"></div>

    <div class="g inc-g">
      <div class="panel s7 inc-chart-panel">
        <div class="panel-title">
          <div>차트</div>
          <div class="inc-legend">
            <span><i class="inc-sw solid"></i>이번 달</span>
            <span><i class="inc-sw hollow"></i>지난 ${expStats.months || 0}개월 월평균</span>
          </div>
        </div>
        <div class="chart-wrap inc-chart-wrap" id="now-exp-chartwrap"><canvas id="chart-now-expense"></canvas></div>
      </div>

      <div class="panel s5 inc-list-panel exp-editlist">
        <div class="panel-title">
          <div>내역</div>
          <span class="ptag" id="now-exp-ptag"></span>
        </div>
        <div class="exp-editscroll"><div id="now-expright-body"></div></div>
        <div class="settings-note">칸을 더블클릭하면 그 자리에서 고쳐집니다 · 🏢 회사 환급 · 📌 고정비 · GOOD/BAD 는 눌러서 바꿉니다.</div>
      </div>
    </div>` : ''}

    ${NSUB === 'saving' ? `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">순저축</div>
        <div class="value" style="color:${sNet >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatKrw(sNet)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : cmpSub(sNet, avgNet, false, avgNote)}
      </div>
      <div class="stat-card">
        <div class="label">저축률</div>
        <div class="value" style="color:${sRate === null ? 'var(--text)' : sRate >= rateTarget ? 'var(--net-text)' : 'var(--expense-text)'}">${sRate === null ? '—' : sRate.toFixed(1) + '%'}</div>
        ${cmpSubPp(sRate, rateTarget, `목표 ${rateTarget}% 대비`)}
      </div>
      <div class="stat-card">
        <div class="label">투자원금 이체</div>
        <div class="value" style="color:var(--accent-text)">${formatKrw(investTr)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : nowDeltaSub(investTr, prevInvestSame, false, cmpNote)}
      </div>
      <div class="stat-card">
        <div class="label">자산 유입 합계</div>
        <div class="value">${formatKrw(transferTotal)}</div>
        <div class="sub">순저축의 <b>${sNet > 0 ? ((transferTotal / sNet) * 100).toFixed(0) + '%' : '—'}</b></div>
      </div>
    </div>

    <div class="g">
      <div class="panel s5">
        <div class="panel-title"><div>이체</div><span class="ptag">${week ? week.label : monthKeyLabel(monthKey)}</span></div>
        <div id="now-transfer-body"></div>
      </div>
      <div class="panel s7">
        <div class="panel-title"><div>주차별 순저축</div></div>
        <div id="now-week-body"></div>
      </div>
    </div>` : ''}
  `;

  container.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => {
    state.nowSub = el.dataset.goto;
    renderPage();
  }));

  /* 변동 요인 한 줄을 누르면 그 분류가 펼쳐진 지출 탭으로 바로 간다 —
     "왜 늘었지?"에서 "무엇 때문에 늘었지?"까지 한 번에 닿게. */
  container.querySelectorAll('[data-drv]').forEach(el => el.addEventListener('click', () => {
    state.nowSub = 'expense';
    state.nowExpFilter = 'all';
    state.nowExpOpen = el.dataset.drv;
    state.nowExpSel = el.dataset.drv;
    renderPage();
  }));

  document.getElementById('now-subnav').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.nowSub = btn.dataset.sub;
    renderPage();
  });


  /* --- 고정비 --- */
  const fixedBody = document.getElementById('now-fixed-body');
  if (fixedBody) fixedBody.innerHTML = `
    <div class="now-kv"><span>완료 ${fixedRows.length - fixedPending.length}건</span><b>${formatKrw(fixedPaidSum)}</b></div>
    <div class="now-kv"><span>미결제 ${fixedPending.length}건</span><b style="color:${fixedPending.length ? 'var(--expense-text)' : 'var(--income-text)'}">${formatKrw(fixedPendingSum)}</b></div>
    <div style="max-height:220px;overflow-y:auto;margin-top:10px;">
      ${fixedRows.length ? fixedRows.map(f => `
        <div class="acct-row">
          <span style="width:16px;flex-shrink:0;">${f.paid !== null ? '✅' : '⬜'}</span>
          <span class="acct-name" style="${f.paid === null ? 'color:var(--text-dim)' : ''}">${f.item}${f.vendor ? `<div class="acct-cat">${f.vendor}</div>` : ''}</span>
          <span class="acct-amt" style="${f.paid === null ? 'color:var(--text-faint)' : ''}">${formatKrw(f.paid !== null ? f.paid : f.expected)}</span>
        </div>`).join('') : '<div class="empty-state">고정비로 표시된 항목이 없어요.</div>'}
    </div>
  `;

  /* --- 이체 --- */
  const trBody = document.getElementById('now-transfer-body');
  if (trBody) trBody.innerHTML = `
    <div class="now-kv"><span>합계</span><b style="color:var(--transfer-text)">${formatKrw(transferTotal)}</b></div>
    <div style="margin-top:8px;">
      ${transferRows.length ? transferRows.map(t => `
        <div class="acct-row">
          <span class="acct-name">${t.name}<div class="acct-cat">${Object.keys(t.detail).join(' · ')}</div></span>
          <span class="acct-amt">${formatKrw(t.total)}</span>
        </div>`).join('') : '<div class="empty-state">이 기간 이체 내역이 없어요.</div>'}
    </div>
  `;

  /* --- 수입: 지표 카드 · 차트 · 내역 -----------------------------------------
     축 라벨(▸/▾) 쪽을 누르면 그냥 펼치기만, 막대 쪽을 누르면 그 항목을 골라
     지표 카드와 내역이 함께 따라온다. 고를 때 화면 전체를 다시 그리지 않는다. */
  if (NSUB === 'income') {
    const wrap = document.getElementById('now-inc-chartwrap');
    const canvas = document.getElementById('chart-now-income');
    const rBody = document.getElementById('now-incright-body');
    const ptag = document.getElementById('now-inc-ptag');
    const statBox = document.getElementById('now-inc-stats');
    const scopeBox = document.getElementById('now-inc-scope');
    const SEL_C = '#e8c96a';
    let R = incBuildRows(state.nowIncOpen);
    const heightOf = (rows) => Math.max(200, 44 + rows.length * 44);

    const on = (r) => !state.nowIncSel || (r.sel && (r.sel === state.nowIncSel || state.nowIncSel.startsWith(r.sel + ' › ')));
    const isSel = (r) => !!r.sel && r.sel === state.nowIncSel;
    const curBg = (r) => hexToRgba(r.color, !on(r) ? .13 : isSel(r) ? 1 : r.level === 2 ? .58 : .9);
    const avgBg = (r) => hexToRgba(r.color, !on(r) ? .04 : r.level === 2 ? .13 : .2);
    const avgLine = (r) => hexToRgba(r.color, !on(r) ? .15 : r.level === 2 ? .42 : .7);
    const curLine = (r) => isSel(r) ? SEL_C : 'transparent';
    const tickColor = (i) => {
      const r = R[i];
      if (!r) return '#9aa3b6';
      if (isSel(r)) return SEL_C;
      if (!on(r)) return r.level === 2 ? '#4a505c' : '#5d6472';
      return r.level === 2 ? '#8f97a6' : '#e2e7f0';
    };
    const fmt = (pick) => (v, i) => {
      const r = R[i];
      if (!r) return '';
      const sh = pick(r);
      return `${formatCompactWon(v)}${sh != null && sh > 0 ? `  ${sh.toFixed(0)}%` : ''}`;
    };

    /* 켜진 줄은 막대 색만으로 부족하다 — 줄 전체에 띠를 깔고, 분류 사이엔 가는 선을 긋는다 */
    const incRowDecor = {
      id: 'incRowDecor',
      beforeDatasetsDraw(chart) {
        const y = chart.scales.y, area = chart.chartArea;
        if (!y || !area) return;
        const band = y.height / Math.max(y.ticks.length, 1);
        const { ctx } = chart;
        ctx.save();
        R.forEach((r, i) => {
          if (r.level !== 1 || r.first) return;
          const top = y.getPixelForTick(i) - band / 2;
          ctx.fillStyle = 'rgba(255,255,255,0.055)';
          ctx.fillRect(0, top, area.right, 1);
        });
        const i = chart.$selIndex;
        if (i != null && i >= 0) {
          const cy = y.getPixelForTick(i);
          ctx.fillStyle = 'rgba(232,201,106,0.09)';
          ctx.fillRect(0, cy - band / 2, area.right, band);
          ctx.fillStyle = SEL_C;
          ctx.fillRect(0, cy - band / 2 + 3, 2, band - 6);
        }
        ctx.restore();
      }
    };

    const scopeStats = () => {
      const sel = state.nowIncSel;
      if (sel) return incStats.of(sel);
      return {
        cur: incStats.curTot, avg: incStats.avgTot,
        diff: incStats.curTot - incStats.avgTot,
        ratio: incStats.avgTot > 0 ? (incStats.curTot / incStats.avgTot) * 100 : null,
        share: 100
      };
    };

    const renderScope = () => {
      if (!scopeBox) return;
      const sel = state.nowIncSel;
      scopeBox.innerHTML = sel
        ? `<span class="inc-chip"><i style="background:${incColorOf(sel)}"></i>${rxEsc(sel)}<button id="inc-scope-clear" title="전체 보기">×</button></span>`
        : '<span class="inc-chip muted">전체 수입</span>';
      const cl = document.getElementById('inc-scope-clear');
      if (cl) cl.addEventListener('click', () => { state.nowIncSel = null; apply(); });
    };

    const renderCards = () => {
      if (!statBox) return;
      const sel = state.nowIncSel;
      const st = scopeStats();
      const n = incRawRowsFor(sel).length;
      const up = st.diff >= 0;
      const rateCol = st.ratio === null ? 'var(--text)' : st.ratio >= 100 ? 'var(--income-text)' : 'var(--expense-text)';
      statBox.innerHTML = `
        <div class="stat-card">
          <div class="label">이번 달 수입</div>
          <div class="value" style="color:var(--income-text)">${formatKrw(st.cur)}</div>
          ${incStats.months ? `<div class="sub" style="color:${up ? 'var(--income-text)' : '#d9884f'}">평소보다 ${up ? '+' : '−'}${formatKrw(Math.abs(Math.round(st.diff)))}</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="label">지난 ${incStats.months || 0}개월 월평균</div>
          <div class="value" style="color:var(--text-dim)">${formatKrw(Math.round(st.avg))}</div>
          <div class="sub">기록이 있는 ${incStats.months || 0}개월 기준</div>
        </div>
        <div class="stat-card">
          <div class="label">달성률</div>
          <div class="value" style="color:${rateCol}">${st.ratio === null ? '—' : Math.round(st.ratio) + '%'}</div>
          <div class="sub">${st.ratio === null ? '평소 기록 없음' : '평소 대비'}</div>
        </div>
        <div class="stat-card">
          <div class="label">${sel ? '이번 달 비중' : '기록'}</div>
          <div class="value">${sel ? `${(st.share || 0).toFixed(0)}%` : `${n}건`}</div>
          <div class="sub">${sel ? '이번 달 수입 중' : '이번 달 수입 기록'}</div>
        </div>`;
    };

    const renderList = () => {
      const sel = state.nowIncSel;
      const rows = incRawRowsFor(sel);
      const sum = rows.reduce((a, r) => a + r.amount, 0);
      if (ptag) ptag.textContent = `${rows.length}건 · ${formatKrw(sum)}`;
      if (!rBody) return;
      rBody.innerHTML = rows.length ? `
        <div class="table-scroll" style="max-height:520px;">
          <table class="data-table inc-raw">
            <thead><tr><th>날짜</th><th>분류 · 항목</th><th>사용처</th><th style="text-align:right">금액</th></tr></thead>
            <tbody>${rows.map(r => {
              const p = parseLedgerDateParts(r.date);
              return `<tr data-day="${r.dayKey || ''}" title="${rxEsc(r.memo || '')}">
              <td class="c-date">${p ? `${p.mo}/${p.d}` : r.date}</td>
              <td class="c-cat">${rxCat(r)}</td>
              <td class="c-vendor">${rxEsc((r.vendor || '').split('›').pop().trim())}${r.memo ? `<div class="acct-cat">${rxEsc(r.memo)}</div>` : ''}</td>
              <td class="amt c-amt" title="${wonComma(r.amount)}원"><span class="v 수입">${formatKrw(r.amount)}</span></td>
            </tr>`; }).join('')}</tbody>
          </table>
        </div>`
        : `<div class="empty-state">${sel ? `${rxEsc(sel)} 수입이 이번 달엔 없어요.` : '이 기간 수입 내역이 없어요.'}</div>`;
      rBody.querySelectorAll('tr[data-day]').forEach(tr => tr.addEventListener('click', () => {
        const k = tr.dataset.day;
        if (!k || k > todayDayKey()) return;
        state.todayDayKey = k;
        goTo('home', 'main');
      }));
    };

    const apply = () => {
      R = incBuildRows(state.nowIncOpen);
      const ch = state.charts.nowIncome;
      if (ch) {
        ch.$selIndex = R.findIndex(isSel);
        ch.data.labels = R.map(r => r.label);
        const [d0, d1] = ch.data.datasets;
        d0.data = R.map(r => r.cur);
        d0.backgroundColor = R.map(curBg);
        d0.borderColor = R.map(curLine);
        d0.borderWidth = R.map(r => isSel(r) ? 2 : 0);
        d1.data = R.map(r => r.avg);
        d1.backgroundColor = R.map(avgBg);
        d1.borderColor = R.map(avgLine);
        if (wrap) wrap.style.height = heightOf(R) + 'px';
        ch.resize();
        ch.update('none');   /* 막대가 0에서 다시 자라지 않게 */
      }
      renderScope(); renderCards(); renderList();
    };

    if (wrap) wrap.style.height = heightOf(R) + 'px';
    if (canvas) {
      if (state.charts.nowIncome) state.charts.nowIncome.destroy();
      const ch = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: R.map(r => r.label),
          datasets: [
            {
              label: '이번 달', data: R.map(r => r.cur),
              backgroundColor: R.map(curBg), borderColor: R.map(curLine),
              borderWidth: R.map(r => isSel(r) ? 2 : 0),
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r ? '#dfe4ee' : isSel(r) ? SEL_C : !on(r) ? '#4e5563' : r.level === 2 ? '#c3cad6' : '#eef1f7'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "700 12.5px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.share)
            },
            {
              label: '지난 월평균', data: R.map(r => r.avg),
              backgroundColor: R.map(avgBg), borderColor: R.map(avgLine), borderWidth: 1,
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r || on(r) ? '#8b93a5' : '#454b58'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "500 11px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.avgShare)
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { right: 116, left: 0 } },
          /* 가로 막대라 인덱스 축이 y다 */
          interaction: { mode: 'index', intersect: false, axis: 'y' },
          plugins: {
            legend: { display: false },
            tooltip: {
              filter: (item) => item.raw !== null && item.raw !== undefined,
              callbacks: {
                title: (items) => items.length ? String(R[items[0].dataIndex].label).replace(/^[▸▾\s]+/, '') : '',
                label: (c) => ` ${c.dataset.label}: ${formatKrw(c.raw)}`,
                afterBody: (items) => {
                  if (!items.length) return '';
                  const r = R[items[0].dataIndex];
                  if (!r) return '';
                  return [r.ratio === null
                    ? '평소 기록 없음'
                    : `평소 대비 ${r.ratio.toFixed(0)}% (${r.diff >= 0 ? '+' : '−'}${formatKrw(Math.abs(Math.round(r.diff)))})`];
                }
              }
            }
          },
          scales: {
            x: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
            y: {
              ticks: {
                ...MONO_TICK, crossAlign: 'far', autoSkip: false, padding: 8,
                color: (ctx) => tickColor(ctx.index),
                font: (ctx) => {
                  const r = R[ctx.index];
                  return {
                    family: r && r.level === 2 ? 'Inter, system-ui, sans-serif' : 'IBM Plex Mono',
                    size: r && r.level === 2 ? 11.5 : 13,
                    weight: r && r.level === 2 ? 400 : 700
                  };
                }
              },
              grid: { display: false }
            }
          }
        },
        plugins: [incRowDecor, valueLabelPlugin]
      });
      state.charts.nowIncome = ch;
      ch.$selIndex = R.findIndex(isSel);

      /* 클릭은 직접 받는다 — 축 라벨(▸/▾) 영역은 '펼치기만', 막대 영역은 '고르기'.
         Chart.js 의 onClick 은 차트 영역 밖(축 라벨 쪽)에서 직전 hover 를 물고 와서 못 쓴다. */
      const rowAt = (py) => {
        const area = ch.chartArea;
        if (!area || py < area.top || py > area.bottom) return -1;
        const i = Math.round(ch.scales.y.getValueForPixel(py));
        return (i >= 0 && i < R.length) ? i : -1;
      };
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const i = rowAt(py);
        if (i < 0) return;
        const r = R[i];
        if (px < ch.chartArea.left) {
          if (r.level === 1) { state.nowIncOpen = state.nowIncOpen === r.cat ? null : r.cat; apply(); }
          return;
        }
        state.nowIncSel = state.nowIncSel === r.sel ? null : r.sel;
        apply();
      });
      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const py = e.clientY - rect.top, px = e.clientX - rect.left;
        const i = rowAt(py);
        canvas.style.cursor = i < 0 ? 'default'
          : (px < ch.chartArea.left && R[i].level !== 1) ? 'default' : 'pointer';
      });
    }
    renderScope(); renderCards(); renderList();
  }

  /* --- 지출: 지표 카드 · 차트 · 내역 -----------------------------------------
     수입 탭과 같은 조작을 그대로 쓴다. 축 라벨(▸/▾)은 펼치기, 막대는 고르기.
     다른 점은 방향뿐이다 — 지출은 평소보다 적게 쓴 쪽이 좋은 소식이라 색이 뒤집힌다. */
  if (NSUB === 'expense') {
    const wrap = document.getElementById('now-exp-chartwrap');
    const canvas = document.getElementById('chart-now-expense');
    const rBody = document.getElementById('now-expright-body');
    const ptag = document.getElementById('now-exp-ptag');
    const statBox = document.getElementById('now-exp-stats');
    const scopeBox = document.getElementById('now-exp-scope');
    const SEL_C = '#e8c96a';
    let R = expBuildRows(state.nowExpOpen);
    const heightOf = (rows) => Math.max(200, 44 + rows.length * 44);

    const on = (r) => !state.nowExpSel || (r.sel && (r.sel === state.nowExpSel || state.nowExpSel.startsWith(r.sel + ' › ')));
    const isSel = (r) => !!r.sel && r.sel === state.nowExpSel;
    const curBg = (r) => hexToRgba(r.color, !on(r) ? .13 : isSel(r) ? 1 : r.level === 2 ? .58 : .9);
    const avgBg = (r) => hexToRgba(r.color, !on(r) ? .04 : r.level === 2 ? .13 : .2);
    const avgLine = (r) => hexToRgba(r.color, !on(r) ? .15 : r.level === 2 ? .42 : .7);
    const curLine = (r) => isSel(r) ? SEL_C : 'transparent';
    const tickColor = (i) => {
      const r = R[i];
      if (!r) return '#9aa3b6';
      if (isSel(r)) return SEL_C;
      if (!on(r)) return r.level === 2 ? '#4a505c' : '#5d6472';
      return r.level === 2 ? '#8f97a6' : '#e2e7f0';
    };
    const fmt = (pick) => (v, i) => {
      const r = R[i];
      if (!r) return '';
      const sh = pick(r);
      return `${formatCompactWon(v)}${sh != null && sh > 0 ? `  ${sh.toFixed(0)}%` : ''}`;
    };

    const expRowDecor = {
      id: 'expRowDecor',
      beforeDatasetsDraw(chart) {
        const y = chart.scales.y, area = chart.chartArea;
        if (!y || !area) return;
        const band = y.height / Math.max(y.ticks.length, 1);
        const { ctx } = chart;
        ctx.save();
        R.forEach((r, i) => {
          if (r.level !== 1 || r.first) return;
          const top = y.getPixelForTick(i) - band / 2;
          ctx.fillStyle = 'rgba(255,255,255,0.055)';
          ctx.fillRect(0, top, area.right, 1);
        });
        const i = chart.$selIndex;
        if (i != null && i >= 0) {
          const cy = y.getPixelForTick(i);
          ctx.fillStyle = 'rgba(232,201,106,0.09)';
          ctx.fillRect(0, cy - band / 2, area.right, band);
          ctx.fillStyle = SEL_C;
          ctx.fillRect(0, cy - band / 2 + 3, 2, band - 6);
        }
        ctx.restore();
      }
    };

    const scopeStats = () => {
      const sel = state.nowExpSel;
      if (sel) return expStats.of(sel);
      return {
        cur: expStats.curTot, avg: expStats.avgTot,
        diff: expStats.curTot - expStats.avgTot,
        ratio: expStats.avgTot > 0 ? (expStats.curTot / expStats.avgTot) * 100 : null,
        share: 100
      };
    };

    const renderScope = () => {
      if (!scopeBox) return;
      const sel = state.nowExpSel;
      scopeBox.innerHTML = `
        ${sel
          ? `<span class="inc-chip"><i style="background:${expColorOf(sel)}"></i>${rxEsc(sel)}<button id="exp-scope-clear" title="전체 보기">×</button></span>`
          : '<span class="inc-chip muted">전체 지출</span>'}
        <span class="exp-fchips">${EXP_BUCKETS.map(b => `
          <button class="exp-fchip ${EXPF === b.key ? 'on' : ''}" data-expf="${b.key}">
            ${b.label}<b>${formatCompactWon(b.value)}</b>
          </button>`).join('')}</span>`;
      const cl = document.getElementById('exp-scope-clear');
      if (cl) cl.addEventListener('click', () => { state.nowExpSel = null; apply(); });
      scopeBox.querySelectorAll('.exp-fchip').forEach(el => el.addEventListener('click', () => {
        state.nowExpFilter = el.dataset.expf;
        renderPage();   /* 필터는 기준선(평소 월평균)까지 바꾼다 — 통째로 다시 센다 */
      }));
    };

    const renderCards = () => {
      if (!statBox) return;
      const sel = state.nowExpSel;
      const st = scopeStats();
      const n = expRawRowsFor(sel).length;
      const less = st.diff <= 0;   /* 지출은 적게 쓴 쪽이 좋은 소식 */
      const rateCol = st.ratio === null ? 'var(--text)' : st.ratio > 100 ? 'var(--expense-text)' : 'var(--income-text)';
      statBox.innerHTML = `
        <div class="stat-card">
          <div class="label">이번 달 지출</div>
          <div class="value" style="color:var(--expense-text)">${formatKrw(st.cur)}</div>
          ${expStats.months ? `<div class="sub" style="color:${less ? 'var(--income-text)' : 'var(--expense-text)'}">평소보다 ${less ? '−' : '+'}${formatKrw(Math.abs(Math.round(st.diff)))}</div>` : ''}
          ${isThisMonth && !week ? `<div class="sub">월말 예상 <b>${formatKrw(Math.round(st.cur * projRate))}</b></div>` : ''}
        </div>
        <div class="stat-card">
          <div class="label">지난 ${expStats.months || 0}개월 월평균</div>
          <div class="value" style="color:var(--text-dim)">${formatKrw(Math.round(st.avg))}</div>
          <div class="sub">기록이 있는 ${expStats.months || 0}개월 기준</div>
        </div>
        <div class="stat-card">
          <div class="label">평소 대비</div>
          <div class="value" style="color:${rateCol}">${st.ratio === null ? '—' : Math.round(st.ratio) + '%'}</div>
          <div class="sub">${st.ratio === null ? '평소 기록 없음' : (isThisMonth ? `D+${elapsed} / ${M.days}일 시점` : '마감 기준')}</div>
        </div>
        <div class="stat-card">
          <div class="label">${sel ? '이번 달 비중' : '기록'}</div>
          <div class="value">${sel ? `${(st.share || 0).toFixed(0)}%` : `${n}건`}</div>
          <div class="sub">${sel ? '이번 달 지출 중' : '이번 달 지출 기록'}</div>
        </div>`;
    };

    const renderList = () => {
      const sel = state.nowExpSel;
      const rows = expRawRowsFor(sel);
      const sum = rows.reduce((a, r) => a + netOfR(r), 0);
      if (ptag) ptag.textContent = `${rows.length}건 · ${formatKrw(sum)}`;
      /* 다른 화면으로 보내지 않는다 — 고칠 곳은 보고 있는 자리다 */
      rxMountEditableDays(rBody, rows,
        sel ? `${rxEsc(sel)} 지출이 이번 달엔 없어요.` : '이 조건의 지출 내역이 없어요.');
    };

    const apply = () => {
      R = expBuildRows(state.nowExpOpen);
      const ch = state.charts.nowExpenseCat;
      if (ch) {
        ch.$selIndex = R.findIndex(isSel);
        ch.data.labels = R.map(r => r.label);
        const [d0, d1] = ch.data.datasets;
        d0.data = R.map(r => r.cur);
        d0.backgroundColor = R.map(curBg);
        d0.borderColor = R.map(curLine);
        d0.borderWidth = R.map(r => isSel(r) ? 2 : 0);
        d1.data = R.map(r => r.avg);
        d1.backgroundColor = R.map(avgBg);
        d1.borderColor = R.map(avgLine);
        if (wrap) wrap.style.height = heightOf(R) + 'px';
        ch.resize();
        ch.update('none');
      }
      renderScope(); renderCards(); renderList();
    };

    if (wrap) wrap.style.height = heightOf(R) + 'px';
    if (canvas) {
      if (state.charts.nowExpenseCat) state.charts.nowExpenseCat.destroy();
      const ch = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: R.map(r => r.label),
          datasets: [
            {
              label: '이번 달', data: R.map(r => r.cur),
              backgroundColor: R.map(curBg), borderColor: R.map(curLine),
              borderWidth: R.map(r => isSel(r) ? 2 : 0),
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r ? '#dfe4ee' : isSel(r) ? SEL_C : !on(r) ? '#4e5563' : r.level === 2 ? '#c3cad6' : '#eef1f7'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "700 12.5px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.share)
            },
            {
              label: '지난 월평균', data: R.map(r => r.avg),
              backgroundColor: R.map(avgBg), borderColor: R.map(avgLine), borderWidth: 1,
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r || on(r) ? '#8b93a5' : '#454b58'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "500 11px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.avgShare)
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { right: 116, left: 0 } },
          interaction: { mode: 'index', intersect: false, axis: 'y' },
          plugins: {
            legend: { display: false },
            tooltip: {
              filter: (item) => item.raw !== null && item.raw !== undefined,
              callbacks: {
                title: (items) => items.length ? String(R[items[0].dataIndex].label).replace(/^[▸▾\s]+/, '') : '',
                label: (c) => ` ${c.dataset.label}: ${formatKrw(c.raw)}`,
                afterBody: (items) => {
                  if (!items.length) return '';
                  const r = R[items[0].dataIndex];
                  if (!r) return '';
                  return [r.ratio === null
                    ? '평소 기록 없음'
                    : `평소 대비 ${r.ratio.toFixed(0)}% (${r.diff >= 0 ? '+' : '−'}${formatKrw(Math.abs(Math.round(r.diff)))})`];
                }
              }
            }
          },
          scales: {
            x: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
            y: {
              ticks: {
                ...MONO_TICK, crossAlign: 'far', autoSkip: false, padding: 8,
                color: (ctx) => tickColor(ctx.index),
                font: (ctx) => {
                  const r = R[ctx.index];
                  return {
                    family: r && r.level === 2 ? 'Inter, system-ui, sans-serif' : 'IBM Plex Mono',
                    size: r && r.level === 2 ? 11.5 : 13,
                    weight: r && r.level === 2 ? 400 : 700
                  };
                }
              },
              grid: { display: false }
            }
          }
        },
        plugins: [expRowDecor, valueLabelPlugin]
      });
      state.charts.nowExpenseCat = ch;
      ch.$selIndex = R.findIndex(isSel);

      const rowAt = (py) => {
        const area = ch.chartArea;
        if (!area || py < area.top || py > area.bottom) return -1;
        const i = Math.round(ch.scales.y.getValueForPixel(py));
        return (i >= 0 && i < R.length) ? i : -1;
      };
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const i = rowAt(py);
        if (i < 0) return;
        const r = R[i];
        if (px < ch.chartArea.left) {
          if (r.level === 1) { state.nowExpOpen = state.nowExpOpen === r.cat ? null : r.cat; apply(); }
          return;
        }
        state.nowExpSel = state.nowExpSel === r.sel ? null : r.sel;
        apply();
      });
      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const py = e.clientY - rect.top, px = e.clientX - rect.left;
        const i = rowAt(py);
        canvas.style.cursor = i < 0 ? 'default'
          : (px < ch.chartArea.left && R[i].level !== 1) ? 'default' : 'pointer';
      });
    }
    renderScope(); renderCards(); renderList();
  }

  /* --- 카테고리 --- */
  const catBody = document.getElementById('now-cat-body');
  const catMax = Math.max(...catRows.map(r => Math.max(r.cur, r.prev)), 1);
  const showCatDelta = !week;
  if (catBody) catBody.innerHTML = (catRows.length ? catRows.map(r => {
    const diff = r.cur - r.prev;
    let deltaHtml = '';
    if (showCatDelta) {
      const txt = r.prev === 0 ? '신규' : diff === 0 ? '동일' : `${diff > 0 ? '+' : '−'}${formatKrw(Math.abs(diff))}`;
      const col = r.prev === 0 ? 'var(--text-faint)' : diff > 0 ? 'var(--expense-text)' : diff < 0 ? 'var(--income-text)' : 'var(--text-faint)';
      deltaHtml = ` · <span style="color:${col}">${cmpNote} ${txt}</span>`;
    }
    return `<div class="budget-row-compact">
      <span class="b-name" title="${r.name}">${r.name}</span>
      <div class="b-bar-track"><div class="b-bar-fill ${showCatDelta && diff > 0 && r.prev > 0 ? 'over' : ''}" style="width:${(r.cur / catMax) * 100}%"></div></div>
      <span class="b-figures">${formatKrw(r.cur)} · ${r.pct.toFixed(0)}%${deltaHtml}</span>
    </div>`;
  }).join('') : '<div class="empty-state">이 기간 지출 내역이 없어요.</div>')
  + (showCatDelta ? `<div class="settings-note">비교 기준 · ${cmpRange}${isThisMonth ? ' 같은 기간' : ''}</div>` : '');

  /* --- TOP 지출 --- */
  if (document.getElementById('now-top-body')) document.getElementById('now-top-body').innerHTML = `
    <div class="table-scroll" style="max-height:320px;">
      <table class="data-table">
        <thead><tr><th>날짜</th><th>항목</th><th>사용처</th><th style="text-align:right">금액</th></tr></thead>
        <tbody>${topExpenses.length ? topExpenses.map(r => `<tr><td>${r.date}</td><td>${r.item}</td><td>${r.vendor || ''}</td><td class="amt expense" title="${wonComma(r.amount)}원">${formatKrw(r.amount)}</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:20px;">지출 내역이 없어요.</td></tr>'}</tbody>
      </table>
    </div>
  `;

  /* --- 주차별 요약 --- */
  const weekMax = Math.max(...M.weeks.map(w => w.expense), 1);
  if (document.getElementById('now-week-body')) document.getElementById('now-week-body').innerHTML = `
    <div class="table-scroll" style="max-height:none;">
      <table class="data-table">
        <thead><tr><th>주차</th><th>기간</th><th style="text-align:right">수입</th><th style="text-align:right">지출</th><th style="text-align:right">순액</th></tr></thead>
        <tbody>${M.weeks.map(w => `
          <tr>
            <td>${w.label}</td>
            <td style="color:var(--text-faint);">${w.range}</td>
            <td class="amt income">${w.income ? formatKrw(w.income) : '—'}</td>
            <td class="amt expense">${w.expense ? formatKrw(w.expense) : '—'}</td>
            <td class="amt" style="color:${w.income - w.expense >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatKrw(w.income - w.expense)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    ${M.weeks.length ? `<div class="settings-note">최다 지출 주 · <b style="color:var(--accent-text)">${M.weeks.reduce((a, b) => b.expense > a.expense ? b : a).label}</b> ${formatKrw(weekMax)}</div>` : ''}
  `;

  /* --- 요일별 평균 지출 --- */
  const dowAgg = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  M.daily.forEach(b => {
    if (isThisMonth && b.day > elapsed) return;
    const di = b.dow === 0 ? 6 : b.dow - 1;   // 월=0 … 일=6
    dowAgg[di].sum += b.expense;
    dowAgg[di].n += 1;
  });
  const dowAvg = dowAgg.map((a, i) => ({ name: ['월', '화', '수', '목', '금', '토', '일'][i], avg: a.n ? a.sum / a.n : 0 }));
  const dowMax = Math.max(...dowAvg.map(x => x.avg), 1);
  const dowTop = dowAvg.reduce((a, b) => b.avg > a.avg ? b : a, dowAvg[0]);
  if (document.getElementById('now-dow-body')) document.getElementById('now-dow-body').innerHTML = `
    ${dowAvg.map(x => `
      <div class="dow-avg-row">
        <span class="nm">${x.name}</span>
        <div class="b-bar-track"><div class="b-bar-fill" style="width:${(x.avg / dowMax) * 100}%"></div></div>
        <span class="fig">${x.avg ? formatKrw(Math.round(x.avg)) : '—'}</span>
      </div>`).join('')}
    <div class="settings-note">${dowTop && dowTop.avg > 0 ? `최다 · <b style="color:var(--accent-text)">${dowTop.name}요일</b> 평균 ${formatKrw(Math.round(dowTop.avg))}` : '계산할 지출이 없어요.'}</div>
  `;

  /* --- 내역 테이블 --- */

  /* --- 지출 흐름: 일별 누적 실적 vs 최근 3개월 평균 페이스 --- */
  const drawNowFlow = () => {
    if (!document.getElementById('chart-now-flow')) return;
    if (state.charts.nowFlow) state.charts.nowFlow.destroy();
    const days = M.daily;
    const labels = days.map(b => `${b.day}`);
    /* 이번 달 누적 (아직 안 지난 날은 끊는다) */
    let run = 0;
    const cum = days.map(b => {
      if (isThisMonth && b.day > elapsed) return null;
      run += b.expense;
      return run;
    });
    /* 최근 3개월 같은 날짜까지의 평균 누적 = 평균 페이스 */
    const pace = days.map(b => {
      const v = pacePeerAverage(ledger, monthKey, b.day, 3);
      return v === null ? null : Math.round(v);
    });
    /* 예산이 있으면 목표선도 (총예산 / 일수 × 경과일) */
    const budgetTotal = budgetPaceMonthly(data);
    const budgetLine = budgetTotal > 0 ? days.map(b => Math.round(budgetTotal / M.days * b.day)) : null;

    let irun = 0;
    const cumIncome = days.map(b => {
      if (isThisMonth && b.day > elapsed) return null;
      irun += b.income;
      return irun;
    });
    let nrun = 0;
    const cumNet = days.map(b => {
      if (isThisMonth && b.day > elapsed) return null;
      nrun += (b.income - b.expense);
      return nrun;
    });
    /* 최근 3개월 같은 날짜까지의 평균 누적 페이스 */
    const paceOf = (kw) => days.map(b => {
      const vals = [];
      for (let i = 1; i <= 3; i++) {
        const k = shiftMonthKey(monthKey, -i);
        if (ledger.some(r => ledgerMonthKey(r.date) === k && r.major.includes(kw))) {
          vals.push(cumThroughDay(ledger, k, b.day, kw));
        }
      }
      return vals.length ? Math.round(vals.reduce((a, x) => a + x, 0) / vals.length) : null;
    });
    const paceIncome = paceOf('수입');
    const paceExpense = pace;
    const paceNet = days.map((b, i) =>
      (paceIncome[i] === null || paceExpense[i] === null) ? null : paceIncome[i] - paceExpense[i]);

    const lastIdx = isThisMonth ? Math.max(elapsed - 1, 0) : days.length - 1;
    const projLine = (arr) => {
      if (!isThisMonth || elapsed <= 0 || elapsed >= days.length) return null;
      const base = arr[lastIdx];
      if (base === null || base === undefined) return null;
      const perDay = base / (lastIdx + 1);
      return days.map((b, i) => (i < lastIdx ? null : Math.round(perDay * (i + 1))));
    };

    const AX = FLOW_AXES.find(a => a.key === state.nowAxis) || FLOW_AXES[1];
    const O = state.nowOpts;
    const SRC = {
      income: { cum: cumIncome, pace: paceIncome, color: '#4c8c6b', label: '수입' },
      expense: { cum, pace: paceExpense, color: '#c1483f', label: '지출' },
      net: { cum: cumNet, pace: paceNet, color: '#9b7fc2', label: '순저축' }
    }[AX.key];
    const proj = projLine(SRC.cum);

    /* 페이스 문구 — 선택한 축에 맞게 */
    const liveIdx = isThisMonth ? Math.max(elapsed - 1, 0) : days.length - 1;
    const curV = SRC.cum[liveIdx], baseV = SRC.pace[liveIdx];
    const tagEl = document.getElementById('now-pace-tag');
    if (tagEl) {
      if (curV === null || baseV === null || baseV === undefined) {
        tagEl.textContent = ''; 
      } else {
        const dv = curV - baseV;
        const better = AX.key === 'expense' ? dv < 0 : dv > 0;
        const verb = AX.key === 'expense' ? (dv > 0 ? '더 쓰는' : '덜 쓰는')
                   : AX.key === 'income' ? (dv > 0 ? '더 버는' : '덜 버는')
                   : (dv > 0 ? '더 모으는' : '덜 모으는');
        tagEl.textContent = `평소보다 ${formatKrw(Math.abs(Math.round(dv)))} ${verb} 페이스`;
        tagEl.style.color = Math.abs(dv) < 1 ? 'var(--text-dim)' : (better ? 'var(--income-text)' : '#d9884f');
      }
    }

    const ds = [];
    /* 같은 축 안에서도 선/색/굵기로 역할을 구분한다:
       실선+면적 = 이번 달 실제 · 같은 색 점선 = 예상 · 회색 긴점선 = 최근 3개월 평균 · 금색 촘촘점선 = 예산 */
    if (AX.key === 'expense' && O.daily) {
      ds.push({ type: 'bar', label: '일별 지출', data: days.map(b => b.expense), backgroundColor: 'rgba(193,72,63,.30)', borderRadius: 2, yAxisID: 'y1', order: 9, hideLabel: true });
    }
    ds.push({ type: 'line', label: `최근 3개월 평균 ${SRC.label} 페이스`, data: SRC.pace,
      borderColor: '#9aa3b6', borderDash: [7, 4], backgroundColor: 'transparent', borderWidth: 1.6,
      pointRadius: 0, tension: .25, spanGaps: true, yAxisID: 'y', order: 4,
      labelColor: '#9aa3b6', labelStep: 999, labelOffset: 14 });
    if (AX.key === 'expense' && O.budget && budgetLine) {
      ds.push({ type: 'line', label: '예산 페이스', data: budgetLine, borderColor: '#c9a227',
        borderDash: [2, 3], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0,
        tension: 0, yAxisID: 'y', order: 5, hideLabel: true });
    }
    if (proj) {
      ds.push({ type: 'line', label: `예상 ${SRC.label}`, data: proj, borderColor: SRC.color,
        borderDash: [4, 4], backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0,
        tension: .25, spanGaps: true, yAxisID: 'y', order: 3,
        labelColor: SRC.color, labelStep: 999, labelOffset: -14 });
    }
    ds.push({ type: 'line', label: `누적 ${SRC.label}`, data: SRC.cum, borderColor: SRC.color,
      backgroundColor: hexToRgba(SRC.color, .12), fill: true, borderWidth: 2.6, pointRadius: 0,
      tension: .25, spanGaps: false, yAxisID: 'y', order: 1,
      labelColor: SRC.color, labelStep: Math.max(Math.ceil(days.length / 6), 1), labelOffset: -14 });

    const legendBox = document.getElementById('now-flow-legend');
    if (legendBox) legendBox.innerHTML = ds.slice().reverse().map(x =>
      `<span><i style="background:${x.borderColor || x.backgroundColor}"></i>${x.label}</span>`).join('');

    state.charts.nowFlow = new Chart(document.getElementById('chart-now-flow'), {
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, right: 12 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => (c.raw === null ? null : ` ${c.dataset.label}: ${formatKrw(c.raw)}`) } }
        },
        scales: {
          x: { ticks: { ...MONO_TICK, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
          y1: { display: !!(AX.key === 'expense' && O.daily), position: 'right', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: { display: false } }
        }
      },
      plugins: [valueLabelPlugin]
    });
  };
  const nowToggles = document.getElementById('now-series-toggles');
  if (nowToggles) nowToggles.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-key]');
    if (!inp) return;
    state.nowOpts[inp.dataset.key] = inp.checked;
    inp.closest('.series-chk').classList.toggle('on', inp.checked);
    drawNowFlow();
  });
  const nowAxisBtns = document.getElementById('now-axis-btns');
  if (nowAxisBtns) nowAxisBtns.addEventListener('click', (e) => {
    const b = e.target.closest('.axis-btn');
    if (!b || state.nowAxis === b.dataset.axis) return;
    state.nowAxis = b.dataset.axis;
    nowAxisBtns.querySelectorAll('.axis-btn').forEach(x => x.classList.toggle('on', x === b));
    if (nowToggles) nowToggles.style.display = state.nowAxis === 'expense' ? '' : 'none';
    drawNowFlow();
  });
  drawNowFlow();

  /* --- 월 이동 --- */
  const setMonth = (k, pinned) => {
    state.nowMonthKey = k;
    state.nowMonthPinned = pinned !== false;
    state.nowWeekIdx = null;
    renderPage();
  };
  document.getElementById('now-month-select').addEventListener('change', (e) => setMonth(e.target.value));
  document.getElementById('now-prev').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i > 0) setMonth(availableKeys[i - 1]);
  });
  document.getElementById('now-next').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i < availableKeys.length - 1) setMonth(availableKeys[i + 1]);
  });
  document.getElementById('now-thismonth').addEventListener('click', () => {
    const t = thisMonthKey();
    setMonth(availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1], false);
  });
}
