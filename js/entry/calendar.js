/* ---------------- page: 캘린더 (수입·지출·이체 한눈에) ---------------- */

const DETAIL_GROUPS = [
  ['수입', '수입', 'income'],
  ['지출', '지출', 'expense'],
  ['이체', '이체', 'transfer']
];


/* 캘린더 셀: 축약하지 않고 전체 금액을 콤마 표기로 보여준다. */
function formatCalWon(n) {
  const neg = n < 0;
  const abs = Math.round(Math.abs(n));
  return (neg ? '-' : '') + abs.toLocaleString('ko-KR');
}

function calHeatColor(mode, ratio) {
  const a = (0.08 + 0.40 * ratio).toFixed(2);
  if (mode === 'income') return `rgba(76,140,107,${a})`;
  if (mode === 'transfer') return `rgba(57,168,189,${a})`;
  return `rgba(193,72,63,${a})`;
}

function renderCalendarPage(container, data, d) {
  const ledger = data.ledger || [];
  if (!ledger.length) {
    container.innerHTML = '<div class="panel full"><div class="empty-state">가계부(D) 데이터를 불러오지 못해 캘린더를 만들 수 없어요.</div></div>';
    return;
  }

  const availableKeys = [...new Set(ledger.map(r => ledgerMonthKey(r.date)).filter(Boolean))].sort();
  if (!state.calMonthKey || !availableKeys.includes(state.calMonthKey)) {
    const t = thisMonthKey();
    state.calMonthKey = availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1];
  }
  const monthKey = state.calMonthKey;
  const [Y, MO] = monthKey.split('-').map(Number);
  const M = buildNowMonth(ledger, monthKey);
  const mode = 'all';
  const realToday = todayDayKey();
  const isThisMonth = monthKey === thisMonthKey();

  /* 선택된 날: 이 달에 속하지 않으면 오늘(또는 마지막 기록일)로 리셋 */
  const dayKeyFor = (day) => `${Y}-${pad2(MO)}-${pad2(day)}`;
  const recordedDays = M.daily.filter(b => b.rows.length).map(b => b.day);
  if (!state.calSelDay || state.calSelDay.slice(0, 7) !== monthKey) {
    state.calSelDay = isThisMonth
      ? realToday
      : dayKeyFor(recordedDays.length ? recordedDays[recordedDays.length - 1] : 1);
  }
  const selDay = state.calSelDay;
  const selBucket = M.daily[parseInt(selDay.slice(8), 10) - 1] || { income: 0, expense: 0, transfer: 0, rows: [] };

  const mIncome = M.daily.reduce((a, b) => a + b.income, 0);
  const mExpense = M.daily.reduce((a, b) => a + b.expense, 0);
  const mTransfer = M.daily.reduce((a, b) => a + b.transfer, 0);
  const recordDays = recordedDays.length;
  const elapsed = Math.max(elapsedDaysOf(monthKey), 0);
  const noSpendDays = M.daily.filter(b => b.day <= (isThisMonth ? elapsed : M.days) && b.expense === 0).length;

  const metricOf = (b) => mode === 'income' ? b.income : mode === 'transfer' ? b.transfer : b.expense;
  const maxMetric = Math.max(...M.daily.map(b => Math.abs(metricOf(b))), 1);

  const monthOptions = availableKeys.slice().reverse()
    .map(k => `<option value="${k}" ${k === monthKey ? 'selected' : ''}>${monthKeyLabel(k)}</option>`).join('');

  /* --- 캘린더 셀 --- */
  const firstDow = new Date(Y, MO - 1, 1).getDay();
  const lead = firstDow === 0 ? 6 : firstDow - 1;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="mcal-cell blank"></div>');
  M.daily.forEach(b => {
    const k = dayKeyFor(b.day);
    const future = k > realToday;
    const metric = Math.abs(metricOf(b));
    const heat = (state.calHeat !== false && !future && metric > 0) ? `background:${calHeatColor(mode, metric / maxMetric)};` : '';
    const dowCls = b.dow === 0 ? 'sun' : b.dow === 6 ? 'sat' : '';
    const lines = [];
    if (!future) {
      if ((mode === 'all' || mode === 'income') && b.income) lines.push(`<span class="mcal-line inc"><i>수입</i>${formatCalWon(b.income)}</span>`);
      if ((mode === 'all' || mode === 'expense') && b.expense) lines.push(`<span class="mcal-line exp"><i>지출</i>${formatCalWon(b.expense)}</span>`);
      if ((mode === 'all' || mode === 'transfer') && b.transfer) lines.push(`<span class="mcal-line trf"><i>이체</i>${formatCalWon(b.transfer)}</span>`);
      if (!lines.length) lines.push(`<span class="mcal-none">${b.rows.length ? '·' : '기록 없음'}</span>`);
    }
    cells.push(`<div class="mcal-cell ${k === selDay ? 'sel' : ''} ${future ? 'future' : ''} ${k === realToday && k !== selDay ? 'real' : ''}" data-k="${k}" style="${heat}">
      <span class="mcal-daynum ${dowCls}">${b.day}${b.rows.length ? `<span class="cnt">${b.rows.length}건</span>` : ''}</span>
      ${lines.join('')}
    </div>`);
  });

  container.innerHTML = `
    <div class="page-daybar">
      <div class="today-datewrap">
        <div class="day-title">${monthKeyLabel(monthKey)}</div>
        <div class="month-nav">
          <button id="cal-prev" ${availableKeys.indexOf(monthKey) <= 0 ? 'disabled' : ''}>◀</button>
          <select id="cal-month-select">${monthOptions}</select>
          <button id="cal-next" ${availableKeys.indexOf(monthKey) >= availableKeys.length - 1 ? 'disabled' : ''}>▶</button>
          <button class="btn small" id="cal-thismonth">이번 달</button>
          <button class="btn small ${state.calHeat === false ? '' : 'on'}" id="cal-heat">지출 진하기</button>
        </div>
      </div>
    </div>

    <div class="g">
    <div class="panel s7">
      <div class="stat-grid" style="margin-bottom:0;">
        <div class="stat-card">
          <div class="label">수입</div>
          <div class="value" style="color:var(--income-text)">${formatKrw(mIncome)}</div>
        </div>
        <div class="stat-card">
          <div class="label">지출</div>
          <div class="value" style="color:var(--expense-text)">${formatKrw(mExpense)}</div>
        </div>
        <div class="stat-card">
          <div class="label">이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatKrw(mTransfer)}</div>
        </div>
        <div class="stat-card">
          <div class="label">순액</div>
          <div class="value" style="color:${mIncome - mExpense >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(mIncome - mExpense)}</div>
        </div>
      </div>

      <div class="mcal-grid mcal-head">
        ${['월', '화', '수', '목', '금', '토', '일'].map((x, i) => `<div class="mcal-dow ${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${x}</div>`).join('')}
      </div>
      <div class="mcal-grid" id="cal-grid">${cells.join('')}</div>
      <div class="mcal-legend">
        <span><i style="background:var(--income-text)"></i>수입</span>
        <span><i style="background:var(--expense-text)"></i>지출</span>
        <span><i style="background:var(--transfer-fill)"></i>이체</span>
        <span><i style="background:var(--panel-2);border:1px dashed var(--gold-soft)"></i>오늘</span>
        <span style="color:var(--text-faint)">${state.calHeat === false ? '날짜 클릭 → 오른쪽 내역' : '진하기 = 지출 규모 · 날짜 클릭 → 오른쪽 내역'}</span>
      </div>
    </div>
    <div class="panel s5" id="panel-cal-day"></div>
    </div>
  `;

  /* --- 선택한 날 상세 --- */
  const dayPanel = document.getElementById('panel-cal-day');
  const selRows = selBucket.rows.slice().sort((a, b) => b.amount - a.amount);
  const selDow = DOW_KR[dowOfDayKey(selDay)];
  dayPanel.innerHTML = `
    <div class="panel-title">
      <div>${dayKeyLabel(selDay)} (${selDow}) <span style="color:var(--text-faint);font-family:var(--mono);font-size:11px;">${selRows.length}건</span></div>
      <div class="month-nav">
        <button id="cal-day-prev">◀</button>
        <button id="cal-day-next" ${selDay >= realToday ? 'disabled' : ''}>▶</button>
        <button class="btn small" id="cal-day-open">오늘 탭에서 보기</button>
      </div>
    </div>
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat-card"><div class="label">수입</div><div class="value" style="color:var(--income-text)">${formatKrw(selBucket.income)}</div></div>
      <div class="stat-card"><div class="label">지출</div><div class="value" style="color:var(--expense-text)">${formatKrw(selBucket.expense)}</div></div>
      <div class="stat-card"><div class="label">이체</div><div class="value" style="color:var(--transfer-text)">${formatKrw(selBucket.transfer)}</div></div>
      <div class="stat-card"><div class="label">순액</div><div class="value" style="color:${selBucket.income - selBucket.expense >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(selBucket.income - selBucket.expense)}</div></div>
    </div>
    <div style="flex:1;overflow-y:auto;">
      ${selRows.length ? DETAIL_GROUPS.map(([gk, gLabel, gCls]) => {
        const rows = selRows.filter(r => r.major.includes(gk));
        if (!rows.length) return '';
        const sum = rows.reduce((a, r) => a + r.amount, 0);
        return `<div class="dtl-group ${gCls}">
          <div class="dtl-group-head ${gCls}"><span>${gLabel} · ${rows.length}건</span><b>${formatKrw(sum)}</b></div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>분류</th><th>사용처</th><th>메모</th><th>체크</th><th style="text-align:right">금액</th></tr></thead>
              <tbody>${rows.map(r => `<tr>
                <td class="c-cat">${rxCat(r)}</td>
                <td class="c-vendor">${rxVendor(r)}</td>
                <td>${r.memo ? rxEsc(r.memo) : '<span class="rx-none">·</span>'}</td>
                <td class="c-marks">${rxMarks(r)}</td>
                <td class="amt c-amt">${rxAmount(r)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`;
      }).join('') : '<div class="empty-state">이 날 기록이 없어요.</div>'}
    </div>
  `;

  const setSel = (k) => {
    if (!k || k > realToday) return;
    if (k.slice(0, 7) !== monthKey) {
      if (!availableKeys.includes(k.slice(0, 7))) return;
      state.calMonthKey = k.slice(0, 7);
    }
    state.calSelDay = k;
    renderPage();
  };
  document.getElementById('cal-day-prev').addEventListener('click', () => setSel(shiftDayKey(selDay, -1)));
  document.getElementById('cal-day-next').addEventListener('click', () => setSel(shiftDayKey(selDay, 1)));
  document.getElementById('cal-day-open').addEventListener('click', () => {
    state.todayDayKey = selDay > realToday ? realToday : selDay;
    goTo('home', 'main');
  });

  document.getElementById('cal-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('.mcal-cell');
    if (!cell || cell.classList.contains('blank') || cell.classList.contains('future')) return;
    state.calSelDay = cell.dataset.k;
    renderPage();
  });

  /* --- 월 이동 / 모드 --- */
  const setMonth = (k) => { state.calMonthKey = k; state.calSelDay = null; renderPage(); };
  document.getElementById('cal-month-select').addEventListener('change', (e) => setMonth(e.target.value));
  document.getElementById('cal-prev').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i > 0) setMonth(availableKeys[i - 1]);
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i < availableKeys.length - 1) setMonth(availableKeys[i + 1]);
  });
  document.getElementById('cal-heat').addEventListener('click', () => {
    state.calHeat = state.calHeat === false;
    renderPage();
  });
  document.getElementById('cal-thismonth').addEventListener('click', () => {
    const t = thisMonthKey();
    setMonth(availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1]);
  });
}
