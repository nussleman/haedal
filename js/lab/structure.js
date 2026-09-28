/* ---------------- page: 구조 (자산 증식 엔진) ----------------
   "돈이 어디로 들어와서 어디로 빠지고 무엇으로 쌓이는가"를 한 화면에 놓고,
   그 위에 지금 내가 손을 대야 하는 지점을 레버리지 순서로 표시한다.
   임팩트는 모두 '연 환산 원' 단위로 계산해서 서로 직접 비교할 수 있게 만든다. */

const STRUCT_CTRL_W = { '높음': 1, '중간': 0.6, '낮음': 0.2 };
const PENSION_LIMIT = 9000000;    /* 연금저축+IRP 합산 세액공제 납입 한도 */
const PENSION_CREDIT = 0.132;     /* 세액공제율: 총급여 5,500만 초과 13.2% / 이하 16.5% → 보수적으로 13.2% */
const CGT_FREE = 2500000;         /* 해외주식 양도소득 기본공제 */
const CGT_TAX_RATE = 0.22;

function structureTargets(goals) {
  const out = { milestones: [] };
  (goals || []).forEach(g => {
    const t = String(pickGoalField(g, 'title') || '');
    const status = String(pickGoalField(g, 'status') || '');
    const done = /완료|달성/.test(status);
    let m;
    if ((m = t.match(/비상금\s*([\d,]+)\s*만원/))) {
      const v = parseFloat(m[1].replace(/,/g, '')) * 10000;
      out.emergency = Math.max(out.emergency || 0, v);
    }
    if ((m = t.match(/고정비\s*([\d,]+)\s*만원/))) {
      const v = parseFloat(m[1].replace(/,/g, '')) * 10000;
      out.fixed = out.fixed ? Math.min(out.fixed, v) : v;
    }
    if ((m = t.match(/현금\s*비율.*?(\d+(?:\.\d+)?)\s*%/))) out.cashPct = parseFloat(m[1]);
    if ((m = t.match(/총자산\s*([\d.]+)\s*억/)) && !done) out.milestones.push(parseFloat(m[1]) * 100000000);
  });
  out.milestones.sort((a, b) => a - b);
  return out;
}

function buildStructureModel(data, d) {
  const ledger = data.ledger || [];
  const allKeys = [...new Set(ledger.map(r => ledgerMonthKey(r.date)).filter(Boolean))].sort();
  const cur = thisMonthKey();
  const closed = allKeys.filter(k => k < cur);            /* 진행 중인 달은 평균을 왜곡하므로 제외 */
  const win = (closed.length >= 3 ? closed : allKeys).slice(-12);
  const winSet = new Set(win);
  const n = win.length || 1;
  const rows = ledger.filter(r => winSet.has(ledgerMonthKey(r.date)));

  const isInc = r => r.major.includes('수입');
  const isExp = r => r.major.includes('지출');
  const isTrf = r => r.major.includes('이체');
  const isTax = r => CGT_RE.test(`${r.item} ${r.memo} ${r.vendor}`);
  const absSum = (pred) => rows.filter(pred).reduce((a, r) => a + Math.abs(r.amount), 0);
  /* 이체는 출금(음수)도 섞여 있으므로 부호를 살려서 순유입으로 본다 */
  const netSum = (pred) => rows.filter(pred).reduce((a, r) => a + r.amount, 0);

  /* 보너스·퇴직금 같은 일회성 유입이 평균을 끌어올리므로
     '연봉 +5%'처럼 반복성을 가정하는 계산에는 중앙값을 쓴다. */
  const monthlySeries = (pred) => {
    const map = {};
    win.forEach(k => { map[k] = 0; });
    rows.filter(pred).forEach(r => {
      const k = ledgerMonthKey(r.date);
      if (k in map) map[k] += Math.abs(r.amount);
    });
    return win.map(k => map[k]);
  };
  const median = (arr) => {
    const a = arr.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  };

  const inc = {
    work: absSum(r => isInc(r) && r.minor.includes('근로')),
    side: absSum(r => isInc(r) && r.minor.includes('부수입')),
    invest: absSum(r => isInc(r) && r.minor.includes('투자')),
    etc: absSum(r => isInc(r) && !r.minor.includes('근로') && !r.minor.includes('부수입') && !r.minor.includes('투자'))
  };
  inc.total = inc.work + inc.side + inc.invest + inc.etc;
  const realized = absSum(r => isInc(r) && r.minor.includes('투자') && /판매/.test(r.item));

  const exp = { total: absSum(isExp) };
  exp.tax = absSum(r => isExp(r) && isTax(r));
  exp.fixed = absSum(r => isExp(r) && r.fixed && !isTax(r));
  exp.variable = Math.max(exp.total - exp.tax - exp.fixed, 0);

  const netSave = inc.total - exp.total;
  const saveRate = inc.total ? (netSave / inc.total) * 100 : 0;

  const trf = {
    invest: netSum(r => isTrf(r) && r.minor.includes('투자')),
    pension: netSum(r => isTrf(r) && r.minor.includes('연금')),
    save: netSum(r => isTrf(r) && r.minor.includes('저축')),
    emergency: netSum(r => isTrf(r) && r.minor.includes('비상금'))
  };
  trf.total = trf.invest + trf.pension + trf.save + trf.emergency;

  const alloc = d.allocation || {};
  const stock = {
    invest: alloc['투자 자산'] || 0,
    pension: alloc['연금 자산'] || 0,
    save: alloc['저축 자산'] || 0,
    cash: alloc['현금 자산'] || 0
  };
  stock.total = d.totalAssets || (stock.invest + stock.pension + stock.save + stock.cash);
  const riskAssets = stock.invest + stock.pension;

  /* 복리 루프: 투자 자산만으로 계산한다.
     전체 자산 증감으로 계산하면 퇴직연금(DC) 회사 부담금처럼
     가계부에 수입으로 안 잡히는 외부 유입이 전부 '시장 손익'으로 오인된다. */
  const invByKey = {};
  (data.assetRows || []).forEach(r => {
    if (r.category !== '투자 자산' || r.amount === null) return;
    const k = assetMonthKey(r.date);
    if (!k) return;
    invByKey[k] = (invByKey[k] || 0) + r.amount;
  });
  const numKey = (k) => parseInt(k.replace('-', ''), 10);
  const snapKeys = Object.keys(invByKey).map(Number).sort((a, b) => a - b);
  const endK = snapKeys.filter(k => k <= numKey(win[win.length - 1])).pop();
  const priorK = snapKeys.filter(k => k < numKey(win[0])).pop();
  const loop = { covered: !!(endK && priorK) };
  if (loop.covered) {
    loop.delta = invByKey[endK] - invByKey[priorK];
    loop.contribution = trf.invest;
    loop.market = loop.delta - trf.invest;
  }

  const medWork = median(monthlySeries(r => isInc(r) && r.minor.includes('근로')));
  const medIncome = median(monthlySeries(isInc));

  return {
    win, n, inc, realized, exp, netSave, saveRate, trf, stock, riskAssets, loop,
    medWork, medIncome,
    per: (v) => v / n,
    ann: (v) => (v / n) * 12
  };
}

function buildStructureActions(m, tg, d) {
  const annWork = m.medWork * 12;      /* 중앙값 기준 = 보너스 없는 '평상시' 연 근로소득 */
  const annFixed = m.ann(m.exp.fixed);
  const annVar = m.ann(m.exp.variable);
  const annRealized = m.ann(m.realized);
  const annPension = m.ann(m.trf.pension);
  const pensionRoom = Math.max(0, PENSION_LIMIT - annPension);
  const emgTarget = tg.emergency || state.goals.emergencyFundTarget;

  const A = [];
  A.push({
    node: '근로소득', stage: '유입', control: '중간',
    name: '주 소득 +5% (연봉·직무 이동)', impact: annWork * 0.05,
    short: '연봉 협상·이동',
    todo: `전체 유입의 대부분이 여기서 나옵니다. 1년에 한두 번뿐인 기회지만 한 번의 효과가 지출 절감 몇 달치를 넘습니다.`
  });
  A.push({
    node: '부수입', stage: '유입', control: '높음', assumed: true,
    name: `부수입으로 고정비 덮기 (월 ${formatCompactWon(m.per(m.exp.fixed))}원)`, impact: annFixed,
    short: '부수입으로 고정비 덮기',
    todo: m.inc.side > 0
      ? `현재 부수입 월 ${formatCompactWon(m.per(m.inc.side))}원. 고정비를 부수입으로 덮으면 월급이 흔들려도 구조가 버팁니다.`
      : `유입 채널이 근로소득 하나뿐입니다. 금액보다 '두 번째 채널의 존재' 자체가 구조를 바꿉니다.`
  });
  A.push({
    node: '고정비', stage: '누수', control: '높음',
    name: '고정비 10% 절감', impact: annFixed * 0.1,
    short: '고정비 −10%',
    todo: `월 ${formatCompactWon(m.per(m.exp.fixed))}원. 한 번 끊으면 매달 자동으로 남습니다. 지출 탭 FIXED COSTS에서 항목별로 확인하세요.`
  });
  A.push({
    node: '변동비', stage: '누수', control: '중간',
    name: '변동비 10% 절감', impact: annVar * 0.1,
    short: '변동비 −10%',
    todo: `월 ${formatCompactWon(m.per(m.exp.variable))}원. 매달 의지로 관리해야 하는 영역이라 고정비보다 유지 비용이 큽니다.`
  });
  A.push({
    node: '세금', stage: '누수', control: '높음',
    name: pensionRoom > 0 ? `연금 세액공제 한도 잔여 ${formatCompactWon(pensionRoom)}원 채우기` : '연금 세액공제 한도 소진 완료',
    impact: pensionRoom * PENSION_CREDIT,
    short: pensionRoom > 0 ? '연금 한도 채우기' : '한도 소진 완료',
    todo: pensionRoom > 0
      ? `연 납입 ${formatCompactWon(annPension)}원 / 한도 900만원. 채우는 만큼 13.2~16.5%가 세금에서 즉시 돌아옵니다. 시장 수익률과 달리 확정된 수익입니다.`
      : `한도 900만원을 채웠습니다. 이 이상 납입은 절세 효과가 없으니 위성 계좌로 보내세요.`
  });
  A.push({
    node: '세금', stage: '누수', control: '높음',
    name: '해외주식 기본공제 250만원 매년 소진', impact: Math.min(annRealized, CGT_FREE) * CGT_TAX_RATE,
    short: '250만 공제 쓰기',
    todo: `최근 12개월 실현이익 ${formatCompactWon(annRealized)}원. 연말에 이익을 250만원 안쪽으로 나눠 실현하면 그만큼은 22%가 붙지 않습니다.`
  });
  A.push({
    node: '투자 수익', stage: '유입', control: '낮음',
    name: '수익률 +1%p', impact: m.riskAssets * 0.01,
    short: '수익률 +1%p',
    todo: `투자성 자산 ${formatCompactWon(m.riskAssets)}원 기준. 종목을 잘 고르는 건 통제 밖이고, 실제로 통제되는 건 비용·분산·안 파는 것뿐입니다.`
  });
  A.push({
    node: '비상금', stage: '배분', control: '높음', risk: true,
    name: '비상금 목표 채우기', impact: null,
    short: '비상금 방어선',
    todo: `현재 비상금 ${formatCompactWon(d.emergencyFund)}원 / 목표 ${formatCompactWon(emgTarget)}원. 비상금이 얇으면 하락장에서 투자 자산을 팔아야 하고, 그 순간 이 엔진이 멈춥니다.`
  });

  A.forEach(a => { a.score = (a.impact || 0) * (STRUCT_CTRL_W[a.control] || 0.5); });
  A.sort((a, b) => b.score - a.score);
  A.forEach((a, i) => { a.rank = i + 1; });
  return { list: A, pensionRoom, annPension, emgTarget, annWork, annFixed, annVar, annRealized };
}

function renderStructurePage(container, data, d) {
  if (!data.ledger || !data.ledger.length) {
    container.innerHTML = '<div class="panel full"><div class="empty-state">가계부(D) 데이터를 불러오지 못해 구조를 계산할 수 없어요.</div></div>';
    return;
  }

  const m = buildStructureModel(data, d);
  const tg = structureTargets(data.goals);
  const AC = buildStructureActions(m, tg, d);
  const actByNode = {};
  AC.list.forEach(a => { if (!actByNode[a.node]) actByNode[a.node] = a; });

  /* 다이어그램 위에 올릴 액션 칩: 상위 4순위 + 리스크 방어 항목만 (나머지는 아래 표에서) */
  const chip = (nodeName) => {
    const a = actByNode[nodeName];
    if (!a) return '';
    const showIt = a.rank <= 4 || a.risk;
    if (!showIt) return '';
    const cls = a.risk ? 'risk' : (a.rank === 1 ? 'p1' : '');
    const badge = a.risk ? '방어' : `${a.rank}순위`;
    const gain = a.impact ? ` <b>+연 ${formatCompactWon(a.impact)}원</b>` : '';
    return `<div class="eng-act ${cls}"><span class="rk">${badge}</span>${a.short}${gain}</div>`;
  };

  const node = (o) => {
    const pctTxt = (o.pct === null || o.pct === undefined) ? '' : `<span class="pct">${o.pct.toFixed(0)}%</span>`;
    const bar = (o.pct === null || o.pct === undefined) ? '' : `<div class="eng-bar"><i class="${o.tone || ''}" style="width:${Math.min(Math.max(o.pct, 0), 100)}%"></i></div>`;
    const chipHtml = chip(o.nm);
    return `<div class="eng-node ${o.cls || ''} ${(o.amount || chipHtml) ? '' : 'zero'}" title="${formatWon(o.amount)}">
      <div class="eng-node-top"><span class="nm">${o.nm}</span>${pctTxt}</div>
      <div class="eng-amt ${o.tone || ''}">${formatCompactWon(o.amount)}원</div>
      ${bar}
      ${o.sub ? `<div class="eng-sub">${o.sub}</div>` : ''}
      ${chipHtml}
    </div>`;
  };

  const pctOf = (v, t) => (t ? (v / t) * 100 : 0);
  const winLabel = `${monthKeyLabel(m.win[0])} ~ ${monthKeyLabel(m.win[m.win.length - 1])}`;

  /* --- 복리 루프 문구 --- */
  const annIncome = m.medIncome * 12;   /* 일회성 유입이 낀 달을 빼기 위해 중앙값 사용 */
  const crossPct = annIncome ? (m.riskAssets / annIncome) * 100 : 0;
  const nextMile = (tg.milestones || []).find(v => v > m.stock.total);
  const annNet = m.ann(m.netSave);
  const emgTargetV = AC.emgTarget;
  const cashRatio = m.stock.total ? (d.emergencyFund / m.stock.total) * 100 : 0;
  const workShare = m.inc.total ? (m.inc.work / m.inc.total) * 100 : 0;
  const coreShare = m.riskAssets ? (m.stock.pension / m.riskAssets) * 100 : 0;
  const pensionFill = (AC.annPension / PENSION_LIMIT) * 100;
  const monthlyFixed = m.per(m.exp.fixed);
  const loopC = Math.max(m.loop.contribution, 0);
  const loopK = m.loop.market;
  const engineIsInput = loopC > Math.abs(loopK);

  /* --- 구조 점검 6항목 (통과/미달) --- */
  const checks = [
    { nm: '저축률', cur: `${m.saveRate.toFixed(1)}%`, tgt: `${state.goals.savingsRateTarget}%`, ok: m.saveRate >= state.goals.savingsRateTarget },
    { nm: '월 고정비', cur: formatCompactWon(monthlyFixed), tgt: tg.fixed ? formatCompactWon(tg.fixed) : '—', ok: tg.fixed ? monthlyFixed <= tg.fixed : null },
    { nm: '비상금', cur: formatCompactWon(d.emergencyFund), tgt: formatCompactWon(emgTargetV), ok: d.emergencyFund >= emgTargetV },
    { nm: '현금 비율', cur: `${cashRatio.toFixed(1)}%`, tgt: tg.cashPct ? `${tg.cashPct}%` : '—', ok: tg.cashPct ? cashRatio >= tg.cashPct : null },
    { nm: '연금 한도', cur: `${Math.max(pensionFill, 0).toFixed(0)}%`, tgt: '100%', ok: pensionFill >= 100 },
    { nm: '유입 집중도', cur: `${workShare.toFixed(0)}%`, tgt: '≤90%', ok: workShare <= 90 }
  ];
  const failCount = checks.filter(c => c.ok === false).length;

  const risk = AC.list.find(a => a.risk && !(d.emergencyFund >= emgTargetV));

  /* ================= 시뮬레이터 =================
     레버 6개를 조정하면 순저축이 바뀌고, 그게 20년 자산 곡선에 반영된다.
     현재값 = 최근 n개월 월평균. 레버는 '얼마로 바꿀지' 절대값으로 입력한다. */
  const LEVERS = [
    { key: 'work',   side: 'in',  nm: '근로소득',   cur: m.per(m.inc.work),     unit: 'won', hint: '연봉 협상·이직' },
    { key: 'side',   side: 'in',  nm: '부수입',     cur: m.per(m.inc.side),     unit: 'won', hint: '두 번째 채널' },
    { key: 'invinc', side: 'in',  nm: '투자 수익',  cur: m.per(m.inc.invest),   unit: 'won', hint: '배당·실현' },
    { key: 'fixed',  side: 'out', nm: '고정비',     cur: m.per(m.exp.fixed),    unit: 'won', hint: '한 번 끊으면 매달' },
    { key: 'var',    side: 'out', nm: '변동비',     cur: m.per(m.exp.variable), unit: 'won', hint: '매달 판단' },
    { key: 'tax',    side: 'out', nm: '세금',       cur: m.per(m.exp.tax),      unit: 'won', hint: '양도세·연금공제' }
  ];
  const RET = { key: 'ret', nm: '연 수익률', cur: 6, unit: 'pct', hint: '투자성 자산 기대수익' };

  if (!state.simLevers) state.simLevers = {};
  const lvVal = (k, def) => (state.simLevers[k] === undefined || state.simLevers[k] === null || state.simLevers[k] === '')
    ? def : Number(state.simLevers[k]);

  const simNow = () => {
    const inc = LEVERS.filter(l => l.side === 'in').reduce((a, l) => a + lvVal(l.key, l.cur), 0);
    const out = LEVERS.filter(l => l.side === 'out').reduce((a, l) => a + lvVal(l.key, l.cur), 0);
    return { inc, out, net: inc - out, ret: lvVal('ret', RET.cur) / 100 };
  };
  const baseNet = m.per(m.netSave);
  const startAssets = m.stock.total;

  /* 월 복리 시뮬 (연 수익률은 투자성 자산 비중만큼만 적용) */
  const riskShare = m.stock.total ? Math.min(m.riskAssets / m.stock.total, 1) : 0;
  const project = (monthlyNet, annualRet, years) => {
    const r = Math.pow(1 + annualRet * riskShare, 1 / 12) - 1;
    const out = [startAssets];
    let v = startAssets;
    for (let i = 1; i <= years * 12; i++) { v = v * (1 + r) + monthlyNet; out.push(v); }
    return out;
  };

  const drawSim = () => {
    const ctx = document.getElementById('chart-sim');
    if (!ctx) return;
    if (state.charts.sim) state.charts.sim.destroy();
    const yrs = state.simYears || 10;
    const cur = simNow();
    const baseLine = project(baseNet, RET.cur / 100, yrs);
    const simLine = project(cur.net, cur.ret, yrs);
    const labels = baseLine.map((_, i) => (i % 12 === 0 ? `${i / 12}년` : ''));
    const mileLines = (tg.milestones || []).filter(v => v > startAssets).slice(0, 2);
    state.charts.sim = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '지금 이대로', data: baseLine, borderColor: 'rgba(154,163,182,.75)', borderDash: [5, 4], backgroundColor: 'transparent', pointRadius: 0, tension: .25, borderWidth: 2 },
          { label: '레버 적용', data: simLine, borderColor: '#c9a227', backgroundColor: 'rgba(201,162,39,.12)', fill: true, pointRadius: 0, tension: .25, borderWidth: 2.5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (it) => `${(it[0].dataIndex / 12).toFixed(1)}년 후`,
            label: (c) => ` ${c.dataset.label}: ${formatCompactWon(c.raw)}원`
          } },
          annotation: undefined
        },
        scales: {
          x: { ticks: { ...MONO_TICK, autoSkip: false, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
        }
      }
    });

    /* 결과 요약 */
    const endBase = baseLine[baseLine.length - 1];
    const endSim = simLine[simLine.length - 1];
    const diff = endSim - endBase;
    const yearsTo = (target) => {
      if (!target) return null;
      const idx = simLine.findIndex(v => v >= target);
      return idx === -1 ? null : (idx / 12);
    };
    const mile = (tg.milestones || []).find(v => v > startAssets);
    document.getElementById('sim-out').innerHTML = `
      <div class="sim-kpi">
        <span><em>${yrs}년 후 자산</em><b>${formatCompactWon(endSim)}원</b></span>
        <span><em>지금 이대로 대비</em><b style="color:${diff >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${diff >= 0 ? '+' : '−'}${formatCompactWon(Math.abs(diff))}원</b></span>
        <span><em>월 순저축</em><b style="color:${cur.net >= baseNet ? 'var(--net-text)' : 'var(--expense-text)'}">${formatCompactWon(cur.net)}원</b><i>현재 ${formatCompactWon(baseNet)}</i></span>
        <span><em>저축률</em><b>${cur.inc > 0 ? ((cur.net / cur.inc) * 100).toFixed(1) : '—'}%</b><i>현재 ${m.saveRate.toFixed(1)}%</i></span>
        ${mile ? `<span><em>${formatCompactWon(mile)}원 도달</em><b>${yearsTo(mile) === null ? `${yrs}년 내 미달` : yearsTo(mile).toFixed(1) + '년'}</b></span>` : ''}
      </div>`;
  };

  const leverRow = (l) => {
    const v = lvVal(l.key, l.cur);
    const changed = Math.round(v) !== Math.round(l.cur);
    const delta = v - l.cur;
    const good = l.side === 'in' ? delta > 0 : delta < 0;
    return `<div class="lv ${changed ? (good ? 'up' : 'down') : ''}">
      <span class="lv-nm">${l.nm}<em>${l.hint}</em></span>
      <span class="lv-cur">현재 ${l.unit === 'pct' ? l.cur + '%' : formatCompactWon(l.cur)}</span>
      <span class="lv-in">
        <input type="text" inputmode="numeric" data-lv="${l.key}" value="${l.unit === 'pct' ? v : wonComma(Math.round(v))}" />
        <i>${l.unit === 'pct' ? '%' : '원'}</i>
      </span>
      <span class="lv-delta">${changed ? `${delta > 0 ? '+' : '−'}${l.unit === 'pct' ? Math.abs(delta).toFixed(1) + '%p' : formatCompactWon(Math.abs(delta))}` : '—'}</span>
    </div>`;
  };

  /* 우선순위 액션 (레버리지 통합) */
  const actions = AC.list.slice();
  const goalFor = (a) => {
    const gs = (data.goals || []).filter(g => pickGoalField(g, 'title'));
    const kw = { '고정비': /고정비/, '변동비': /지출/, '세금': /(연금|양도|세금)/, '비상금': /비상금/, '근로소득': /(수입|소득|연봉)/, '투자 수익': /(수익률|투자)/ };
    const re = kw[a.node];
    if (!re) return null;
    const hit = gs.find(g => re.test(String(pickGoalField(g, 'title'))));
    return hit ? { title: pickGoalField(hit, 'title'), status: pickGoalField(hit, 'status') } : null;
  };

  container.innerHTML = `
    <div class="g">
      <div class="panel s6">
        <div class="panel-title">
          <div>자산 시뮬레이션</div>
          <div class="range-toggle" id="sim-years">
            ${[5, 10, 20].map(y => `<button data-y="${y}" class="${(state.simYears || 10) === y ? 'active' : ''}">${y}년</button>`).join('')}
          </div>
        </div>
        <div class="chart-legend" style="margin-bottom:6px;">
          <span><i style="background:rgba(154,163,182,.75)"></i>지금 이대로</span>
          <span><i style="background:var(--accent-fill)"></i>레버 적용</span>
        </div>
        <div class="chart-wrap" style="min-height:250px;"><canvas id="chart-sim"></canvas></div>
        <div id="sim-out"></div>
      </div>

      <div class="panel s3">
        <div class="panel-title"><div>레버</div><button class="btn small" id="sim-reset">되돌리기</button></div>
        <div class="lv-sec inflow"><span>유입 · 월</span></div>
        ${LEVERS.filter(l => l.side === 'in').map(leverRow).join('')}
        <div class="lv-sec leak"><span>누수 · 월</span></div>
        ${LEVERS.filter(l => l.side === 'out').map(leverRow).join('')}
        <div class="lv-sec ret"><span>수익률 · 연</span></div>
        ${leverRow(RET)}
        <div class="settings-note">현재 금액 = <b>마감된 최근 ${m.n}개월(${monthKeyLabel(m.win[0])}–${monthKeyLabel(m.win[m.win.length - 1])})</b> 월평균. 진행 중인 달은 평균을 왜곡해서 제외했어요. 연 수익률만 기본 6% 가정값이고 나머지는 전부 가계부 실적입니다.</div>
      </div>

      <div class="panel s3">
        <div class="panel-title"><div>지금 할 일</div><span class="ptag">임팩트순</span></div>
        <div class="pri-list">
          ${actions.map(a => {
            const gl = goalFor(a);
            return `<div class="pri ${a.rank === 1 ? 'p1' : ''} ${a.risk ? 'risk' : ''}">
              <span class="pri-rank">${a.risk ? '!' : a.rank}</span>
              <span class="pri-body">
                <b>${a.short}</b>
                <em>${a.node} · 통제력 ${a.control}</em>
                ${gl ? `<span class="pri-goal-chip">🎯 ${gl.title}</span>` : ''}
              </span>
              <span class="pri-imp">${a.impact ? '+' + formatCompactWon(a.impact) : '—'}<i>/연</i></span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  drawSim();
  document.getElementById('sim-years').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.simYears = Number(b.dataset.y);
    document.querySelectorAll('#sim-years button').forEach(x => x.classList.toggle('active', x === b));
    drawSim();
  });
  container.querySelectorAll('input[data-lv]').forEach(inp => {
    inp.addEventListener('change', () => {
      const raw = inp.value.replace(/[^0-9.]/g, '');
      state.simLevers[inp.dataset.lv] = raw === '' ? undefined : Number(raw);
      renderPage();
    });
  });
  document.getElementById('sim-reset').addEventListener('click', () => {
    state.simLevers = {};
    renderPage();
  });
}
