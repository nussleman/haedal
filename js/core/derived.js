/* ---------------- derived analysis ---------------- */

function computeDerived(data) {
  /* 오늘 이후의 달은 자산 스냅샷에 행만 있고 금액이 비어 있는 경우가 있어 전부 제외한다 */
  const _now = new Date();
  const nowAssetKey = _now.getFullYear() * 100 + (_now.getMonth() + 1);
  data = { ...data, assetRows: (data.assetRows || []).filter(r => assetMonthKey(r.date) <= nowAssetKey) };

  const byMonth = {};
  data.assetRows.forEach(r => {
    if (r.amount === null) return;
    byMonth[r.date] = (byMonth[r.date] || 0) + r.amount;
  });
  const assetMonths = Object.keys(byMonth).sort((a, b) => assetMonthKey(a) - assetMonthKey(b));
  const latestMonth = assetMonths[assetMonths.length - 1];
  const prevMonth = assetMonths[assetMonths.length - 2];
  const totalAssets = byMonth[latestMonth] || 0;
  const prevTotalAssets = prevMonth ? byMonth[prevMonth] : null;
  const deltaAssets = prevTotalAssets !== null ? totalAssets - prevTotalAssets : null;
  const deltaPct = (prevTotalAssets && prevTotalAssets !== 0) ? (deltaAssets / Math.abs(prevTotalAssets)) * 100 : null;

  const allocation = {};
  data.assetRows.filter(r => r.date === latestMonth).forEach(r => {
    if (r.amount === null) return;
    allocation[r.category] = (allocation[r.category] || 0) + r.amount;
  });

  const cashLike = (allocation['현금 자산'] || 0) + (allocation['저축 자산'] || 0);
  const emgAcct = (state.settings && state.settings.emergencyAccount) || '';
  const emergencyFund = data.assetRows
    .filter(r => r.date === latestMonth && sameAcct(r.account, emgAcct))
    .reduce((a, r) => a + (r.amount || 0), 0);

  const displayAllocation = {};
  Object.entries(allocation).forEach(([cat, amt]) => {
    const g = DISPLAY_GROUP[cat] || cat;
    displayAllocation[g] = (displayAllocation[g] || 0) + amt;
  });

  const cashflow = data.months.map((m, i) => {
    const income = data.incomeTotal[i];
    const expense = data.expenseTotal[i];
    if (!income || income <= 0) return null;
    const savingsRate = ((income - expense) / income) * 100;
    return { month: m, income, expense, savingsRate };
  }).filter(Boolean);

  const catNames = Object.keys(data.expenseCategories);
  const latestPivotIdx = (() => {
    for (let i = data.months.length - 1; i >= 0; i--) {
      if (data.incomeTotal[i] && data.incomeTotal[i] > 0) return i;
    }
    return data.months.length - 1;
  })();
  const catLatest = {};
  const catAvg3 = {};
  catNames.forEach(name => {
    const vals = data.expenseCategories[name];
    catLatest[name] = vals[latestPivotIdx] || 0;
    const window3 = [vals[latestPivotIdx - 1] || 0, vals[latestPivotIdx - 2] || 0, vals[latestPivotIdx - 3] || 0];
    catAvg3[name] = window3.reduce((a, b) => a + b, 0) / 3;
  });

  /* 자산 증감 분해
     투자 수익(판매수익·배당·이자)은 이미 증권계좌 안에 들어있는 '내부' 수익이라
     외부에서 새로 들어온 돈(순저축)에서 빼야 이중 계산이 안 된다.
       Δ총자산 = 순저축(외부) + 투자·평가손익 */
  const invIncomeSeries = data.incomeCategories['투자 수익'] || [];
  const cashByKey = {};
  data.months.forEach((m, i) => {
    const income = data.incomeTotal[i] || 0;
    const invIncome = invIncomeSeries[i] || 0;
    cashByKey[pivotMonthKey(m)] = { income, invIncome, extIncome: income - invIncome, expense: data.expenseTotal[i] || 0 };
  });
  const decomposition = [];
  for (let i = 1; i < assetMonths.length; i++) {
    const curM = assetMonths[i], prevM = assetMonths[i - 1];
    const totalDelta = byMonth[curM] - byMonth[prevM];
    const cf = cashByKey[assetMonthKey(curM)];
    const netSavings = cf ? (cf.extIncome - cf.expense) : null;   // 외부 순유입
    const marketOther = netSavings !== null ? totalDelta - netSavings : null;
    decomposition.push({
      month: curM, label: assetMonthLabel(curM), totalDelta, netSavings, marketOther,
      extIncome: cf ? cf.extIncome : null, invIncome: cf ? cf.invIncome : null, expense: cf ? cf.expense : null
    });
  }

  return {
    byMonth, assetMonths, latestMonth, prevMonth, totalAssets, prevTotalAssets, deltaAssets, deltaPct,
    allocation, displayAllocation, cashLike, emergencyFund, cashflow, catNames, catLatest, catAvg3, latestPivotIdx, decomposition
  };
}


function computeSuggestedGoals(data, d) {
  const last12 = d.cashflow.slice(-12);
  const avgRate = last12.length ? last12.reduce((a, c) => a + c.savingsRate, 0) / last12.length : 40;
  const suggestedSavings = Math.max(0, Math.round(avgRate / 5) * 5);
  const last3Expense = d.cashflow.slice(-3).map(c => c.expense);
  const avgExpense = last3Expense.length ? last3Expense.reduce((a, b) => a + b, 0) / last3Expense.length : 0;
  const suggestedEmergency = Math.max(500000, Math.round((avgExpense * 3) / 100000) * 100000);
  return { suggestedSavings, suggestedEmergency, avgRate, avgExpense };
}

function ledgerMonthKey(dateStr) {
  const m = (dateStr || '').match(/(\d{4})\.\s*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}`;
}


function getFixedMonthlyTrend(ledger) {
  const byMonth = {};
  ledger.filter(r => r.fixed && r.major.includes('지출')).forEach(r => {
    const key = ledgerMonthKey(r.date);
    if (!key) return;
    byMonth[key] = (byMonth[key] || 0) + r.amount;
  });
  return Object.keys(byMonth).sort().map(k => ({ month: k, total: byMonth[k] }));
}

function getStockProfit(ledger) {
  const map = {};
  ledger.filter(r => r.minor === '투자 수익').forEach(r => {
    let name = r.vendor || '기타';
    if (name.includes('›')) name = name.split('›').pop().trim();
    if (!name) name = '기타';
    map[name] = (map[name] || 0) + r.amount;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function getInvestmentIncomeMonthly(ledger) {
  const byMonthItem = {};
  const items = new Set();
  ledger.filter(r => r.minor === '투자 수익').forEach(r => {
    const key = ledgerMonthKey(r.date);
    if (!key) return;
    byMonthItem[key] = byMonthItem[key] || {};
    byMonthItem[key][r.item] = (byMonthItem[key][r.item] || 0) + r.amount;
    items.add(r.item);
  });
  const months = Object.keys(byMonthItem).sort();
  return { months, items: [...items], byMonthItem };
}





function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}



function amtPct(amt, pct) {
  return `${formatCompactWon(amt)}원 (${pct.toFixed(1)}%)`;
}
