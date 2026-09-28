/* ================= 돈의 흐름표 ================= */
const FM_QUADS = [
  { key: 'income', label: '수입', color: 'var(--income-text)' },
  { key: 'expense', label: '지출', color: 'var(--expense-text)' },
  { key: 'asset', label: '자산', color: 'var(--accent-text)' },
  { key: 'liability', label: '부채', color: '#c1483f' }
];

function flowmapData() {
  if (!state.settings.flowmap) state.settings.flowmap = { income: [], expense: [], asset: [], liability: [] };
  FM_QUADS.forEach(q => { if (!Array.isArray(state.settings.flowmap[q.key])) state.settings.flowmap[q.key] = []; });
  return state.settings.flowmap;
}

function renderFlowMapPage(container, data, d) {
  const fm = flowmapData();
  const sel = state.fmSel || null;
  const sum = (k) => fm[k].reduce((a, x) => a + (Number(x.amount) || 0), 0);

  container.innerHTML = `
    <div class="g">
      <div class="panel s8">
        <div class="panel-title">
          <div>돈의 흐름표</div>
          <div style="display:flex;gap:6px;">
            <button class="btn small" id="fm-seed">가계부에서 채우기</button>
          </div>
        </div>
        <div class="fm-wrap">
          ${['income', 'expense', 'asset', 'liability'].map(k => fmCell(k, fm[k], sum(k))).join('')}
        </div>
        <div class="settings-note">${FM_QUADS.every(q => !fm[q.key].length) ? '<b>가계부에서 채우기</b>를 누르면 최근 6개월 평균 수입·지출과 현재 계좌 잔액으로 초안이 만들어져요. 그 다음 직접 고치면 됩니다.' : '각 칸의 항목을 클릭하면 오른쪽에 상세가 뜹니다. 수입·지출은 월 기준, 자산·부채는 잔액 기준으로 적어두면 읽기 편해요.'}</div>
      </div>
      <div class="panel s4 fm-detail" id="fm-detail"></div>
    </div>
  `;

  renderFmDetail(data, d);

  const wrap = container.querySelector('.fm-wrap');
  if (wrap) wrap.addEventListener('click', (e) => {
    const add = e.target.closest('[data-fm-add]');
    if (add) { openFlowItemEditor(add.dataset.fmAdd, null); return; }
    const head = e.target.closest('[data-fm-quad-head]');
    if (head) {
      const k = head.dataset.fmQuadHead;
      const same = state.fmSel && state.fmSel.whole && state.fmSel.quad === k;
      state.fmSel = same ? null : { quad: k, whole: true, id: null };
      wrap.querySelectorAll('.fm-item').forEach(x => x.classList.remove('on'));
      wrap.querySelectorAll('.fm-h').forEach(x => x.classList.remove('on'));
      if (!same) head.classList.add('on');
      renderFmDetail(data, d);
      return;
    }
    const it = e.target.closest('[data-fm-item]');
    if (it) {
      const same = state.fmSel && state.fmSel.id === it.dataset.fmItem;
      state.fmSel = same ? null : { quad: it.dataset.fmQuad, id: it.dataset.fmItem };
      wrap.querySelectorAll('.fm-item').forEach(x => x.classList.remove('on'));
      wrap.querySelectorAll('.fm-h').forEach(x => x.classList.remove('on'));
      if (!same) it.classList.add('on');
      renderFmDetail(data, d);
      return;
    }
    if (state.fmSel) {
      state.fmSel = null;
      wrap.querySelectorAll('.fm-item').forEach(x => x.classList.remove('on'));
      wrap.querySelectorAll('.fm-h').forEach(x => x.classList.remove('on'));
      renderFmDetail(data, d);
    }
  });
  const seedBtn = container.querySelector('#fm-seed');
  if (seedBtn) seedBtn.addEventListener('click', () => seedFlowMap(data, d));

}

function fmCell(key, items, total) {
  const q = FM_QUADS.find(x => x.key === key);
  return `<div class="fm-cell" data-quad="${key}" style="--qc:${q.color}">
    <div class="fm-h ${(state.fmSel && state.fmSel.whole && state.fmSel.quad === key) ? 'on' : ''}" data-fm-quad-head="${key}">
      <b style="color:${q.color}">${q.label}</b><span>${total ? formatCompactWon(total) : ''}</span>
    </div>
    ${items.map(x => `<div class="fm-item ${(state.fmSel && state.fmSel.id === x.id) ? 'on' : ''}" data-fm-item="${x.id}" data-fm-quad="${key}">
      <span class="nm">${x.name}${x.linkedTo ? `<em style="font-style:normal;color:var(--text-faint);font-size:10.5px;"> → ${x.linkedTo}</em>` : ''}</span>
      <span class="vl">${x.amount ? formatCompactWon(x.amount) : '—'}</span>
    </div>`).join('') || '<div class="empty-state" style="padding:10px 0;font-size:11.5px;">항목 없음</div>'}
    <button class="fm-add" data-fm-add="${key}">+ ${q.label} 항목 추가</button>
  </div>`;
}

/* 흐름표 항목의 세부 내역 — 최근 6개월 월평균.
   '근로소득' 같은 소분류 이름이면 그 아래 세부 항목(급여·월급 외 …)을,
   세부 항목 이름이면 사용처를 쪼개서 보여준다. */
function flowBreakdown(data, d, quad, name) {
  const major = quad === 'income' ? '수입' : quad === 'expense' ? '지출' : null;
  if (!major) return null;
  const nm = String(name || '').trim();
  if (!nm) return null;

  const months = (data.months || []);
  const i = d.latestPivotIdx;
  const keys = new Set();
  for (let k = Math.max(0, i - 5); k <= i; k++) {
    const m = months[k];
    if (!m) continue;
    const pk = pivotMonthKey(m);
    keys.add(`${Math.floor(pk / 100)}-${String(pk % 100).padStart(2, '0')}`);
  }
  const nMonths = keys.size || 1;
  const strip = (v) => String(v || '').replace(/[^\p{L}\p{N}]/gu, '');
  const target = strip(nm);
  const inWindow = (r) => keys.has(ledgerMonthKey(r.date));
  const rows = (data.ledger || []).filter(r => r.major.includes(major) && inWindow(r));
  const net = (r) => major === '지출' ? (r.amount - (r.refund || 0)) : r.amount;

  let level = 'item', hits = rows.filter(r => strip(r.minor) === target);
  if (!hits.length) { level = 'vendor'; hits = rows.filter(r => strip(r.item) === target); }
  if (!hits.length) { level = 'vendor'; hits = rows.filter(r => strip(r.vendor).includes(target) || strip(r.memo).includes(target)); }
  if (!hits.length) return null;

  const agg = {};
  hits.forEach(r => {
    const raw = level === 'item' ? (r.item || '기타') : ((r.vendor || r.memo || r.item || '기타').split('›').pop().trim() || '기타');
    agg[raw] = (agg[raw] || 0) + net(r);
  });
  const list = Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, avg: v / nMonths }));
  const total = list.reduce((a, x) => a + x.avg, 0);
  return { level, months: nMonths, total, list: list.slice(0, 10), count: hits.length };
}

/* ================= 돈의 흐름표 인사이트 =================
   칸(수입/지출/자산/부채) 전체를 누르면 그 칸의 요약과 인사이트,
   개별 항목을 누르면 그 항목의 추이·비중·인사이트를 오른쪽에 띄운다. */

/* 최근 N개월 월별 시계열 (수입·지출) 또는 자산 계좌 잔액 시계열 */
function fmSeriesFor(data, d, quad, name) {
  const months = (data.months || []);
  const i = d.latestPivotIdx;
  const keys = [];
  for (let k = Math.max(0, i - 11); k <= i; k++) {
    const m = months[k];
    if (!m) continue;
    const pk = pivotMonthKey(m);
    keys.push(`${Math.floor(pk / 100)}-${String(pk % 100).padStart(2, '0')}`);
  }
  const strip = (v) => String(v || '').replace(/[^\p{L}\p{N}]/gu, '');

  if (quad === 'income' || quad === 'expense') {
    const major = quad === 'income' ? '수입' : '지출';
    const net = (r) => major === '지출' ? (r.amount - (r.refund || 0)) : r.amount;
    const target = name ? strip(name) : null;
    const map = {};
    keys.forEach(k => { map[k] = 0; });
    (data.ledger || []).forEach(r => {
      if (!r.major.includes(major)) return;
      const k = ledgerMonthKey(r.date);
      if (!(k in map)) return;
      if (target && strip(r.minor) !== target && strip(r.item) !== target
        && !strip(r.vendor).includes(target)) return;
      map[k] += net(r);
    });
    return { keys, values: keys.map(k => map[k]), unit: 'flow' };
  }

  /* 자산: 계좌(또는 전체) 월말 잔액 */
  const am = d.assetMonths || [];
  const slice = am.slice(-12);
  const byM = {};
  slice.forEach(m => { byM[m] = 0; });
  (data.assetRows || []).forEach(r => {
    if (r.amount === null || !(r.date in byM)) return;
    if (name && strip(r.account) !== strip(name)) return;
    byM[r.date] += r.amount;
  });
  return { keys: slice, values: slice.map(m => byM[m]), unit: 'stock', labels: slice.map(assetMonthLabel) };
}

/* 시계열 → 인사이트 문장들 */
function fmInsights(series, ctx) {
  const out = [];
  const v = series.values.filter(x => typeof x === 'number');
  if (v.length < 2) return out;
  const closed = series.unit === 'flow' ? v.slice(0, -1) : v;   /* 진행 중인 달은 추세에서 제외 */
  if (closed.length < 2) return out;

  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  const avg = closed.reduce((a, x) => a + x, 0) / closed.length;
  const half = Math.floor(closed.length / 2);
  const firstHalf = closed.slice(0, half).reduce((a, x) => a + x, 0) / (half || 1);
  const lastHalf = closed.slice(half).reduce((a, x) => a + x, 0) / (closed.length - half || 1);

  const money = (x) => formatCompactWon(Math.abs(Math.round(x)));

  if (prev !== 0) {
    const dp = ((last - prev) / Math.abs(prev)) * 100;
    if (Math.abs(dp) >= 5) {
      out.push({ tone: (ctx.goodUp ? dp > 0 : dp < 0) ? 'good' : 'warn',
        text: `직전 대비 <b>${dp > 0 ? '+' : '−'}${Math.abs(dp).toFixed(0)}%</b> (${money(last - prev)}원 ${dp > 0 ? '증가' : '감소'})` });
    } else {
      out.push({ tone: '', text: `직전과 거의 같아요 (${dp > 0 ? '+' : '−'}${Math.abs(dp).toFixed(0)}%)` });
    }
  }

  if (avg > 0) {
    const vsAvg = ((last - avg) / avg) * 100;
    out.push({ tone: Math.abs(vsAvg) < 10 ? '' : ((ctx.goodUp ? vsAvg > 0 : vsAvg < 0) ? 'good' : 'warn'),
      text: `기간 평균 ${money(avg)}원 대비 <b>${vsAvg > 0 ? '+' : '−'}${Math.abs(vsAvg).toFixed(0)}%</b>` });
  }

  if (firstHalf > 0) {
    const trend = ((lastHalf - firstHalf) / Math.abs(firstHalf)) * 100;
    if (Math.abs(trend) >= 8) {
      out.push({ tone: (ctx.goodUp ? trend > 0 : trend < 0) ? 'good' : 'warn',
        text: `${trend > 0 ? '우상향' : '우하향'} 추세 — 후반 절반이 전반보다 <b>${Math.abs(trend).toFixed(0)}%</b> ${trend > 0 ? '높음' : '낮음'}` });
    } else {
      out.push({ tone: '', text: '뚜렷한 추세 없이 횡보 중' });
    }
  }

  /* 변동성 (플로우만) */
  if (series.unit === 'flow' && avg > 0) {
    const sd = Math.sqrt(closed.reduce((a, x) => a + (x - avg) ** 2, 0) / closed.length);
    const cv = (sd / avg) * 100;
    out.push({ tone: cv > 60 ? 'warn' : '',
      text: cv > 60 ? `월별 편차가 커요 (변동계수 ${cv.toFixed(0)}%) — 평균만 믿기 어려움`
                    : `매달 비교적 일정해요 (변동계수 ${cv.toFixed(0)}%)` });
  }
  return out;
}

function fmSpark(values, color, labels) {
  const v = values.map(x => (typeof x === 'number' ? x : 0));
  if (!v.length) return '';
  const max = Math.max(...v, 1), min = Math.min(...v, 0);
  const range = (max - min) || 1;
  return `<div class="fm-spark">${v.map((x, i) => `
    <span class="fs-bar" title="${labels ? labels[i] : ''} ${formatCompactWon(x)}원">
      <i style="height:${Math.max(((x - min) / range) * 100, 2)}%;background:${color};opacity:${i === v.length - 1 ? 1 : .5}"></i>
    </span>`).join('')}</div>`;
}

/* 칸 전체(수입/지출/자산/부채) 요약 + 인사이트 */
function fmQuadPanel(data, d, quadKey) {
  const q = FM_QUADS.find(x => x.key === quadKey);
  const fm = flowmapData();
  const items = (fm[quadKey] || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  const total = items.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const isFlow = quadKey === 'income' || quadKey === 'expense';
  const goodUp = quadKey === 'income' || quadKey === 'asset';

  const mIn = fm.income.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const mOut = fm.expense.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const assetSum = fm.asset.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const liaSum = fm.liability.reduce((a, x) => a + (Number(x.amount) || 0), 0);

  const series = quadKey === 'liability' ? null : fmSeriesFor(data, d, quadKey, null);
  const ins = series ? fmInsights(series, { goodUp }) : [];

  /* 칸 고유 인사이트 */
  const extra = [];
  if (quadKey === 'income') {
    const labor = items.find(x => /근로/.test(x.name));
    if (labor && total) {
      const pct = (Number(labor.amount) || 0) / total * 100;
      extra.push({ tone: pct > 85 ? 'warn' : 'good',
        text: `근로소득 의존도 <b>${pct.toFixed(0)}%</b>${pct > 85 ? ' — 수입원이 사실상 하나예요' : ' — 근로 외 채널이 살아 있어요'}` });
    }
    if (mOut) extra.push({ tone: mIn > mOut ? 'good' : 'warn',
      text: `월 지출 ${formatCompactWon(mOut)}원의 <b>${(mIn / mOut).toFixed(1)}배</b>를 벌고 있어요` });
  }
  if (quadKey === 'expense') {
    if (mIn) extra.push({ tone: (mOut / mIn) < 0.7 ? 'good' : 'warn',
      text: `수입의 <b>${((mOut / mIn) * 100).toFixed(0)}%</b>를 쓰고 있어요 (저축률 ${(100 - (mOut / mIn) * 100).toFixed(0)}%)` });
    const top = items[0];
    if (top && total) extra.push({ tone: '',
      text: `가장 큰 칸은 <b>${top.name}</b> — 지출의 ${((Number(top.amount) || 0) / total * 100).toFixed(0)}%` });
  }
  if (quadKey === 'asset') {
    const net = assetSum - liaSum;
    extra.push({ tone: '', text: `순자산 <b>${formatCompactWon(net)}원</b> (자산 ${formatCompactWon(assetSum)} − 부채 ${formatCompactWon(liaSum)})` });
    const save = mIn - mOut;
    if (save > 0) extra.push({ tone: '', text: `현재 순저축 속도면 자산이 두 배 되는 데 <b>${Math.ceil(assetSum / save)}개월</b>` });
    const top = items[0];
    if (top && total) extra.push({ tone: ((Number(top.amount) || 0) / total) > 0.6 ? 'warn' : '',
      text: `<b>${top.name}</b> 한 곳에 ${((Number(top.amount) || 0) / total * 100).toFixed(0)}%가 몰려 있어요` });
  }
  if (quadKey === 'liability') {
    if (!total) extra.push({ tone: 'good', text: '등록된 부채가 없어요. 순자산 = 총자산입니다.' });
    else {
      if (mIn) extra.push({ tone: '', text: `월 수입 대비 부채 잔액 <b>${(total / mIn).toFixed(1)}개월치</b>` });
      if (assetSum) extra.push({ tone: (total / assetSum) > 0.4 ? 'warn' : '', text: `자산 대비 부채 비율 <b>${((total / assetSum) * 100).toFixed(0)}%</b>` });
    }
  }

  const all = extra.concat(ins);
  return `
    <div class="fm-dt-h"><b style="color:${q.color}">${q.label} 전체</b>
      <span class="ptag">${items.length}개 항목</span></div>
    <div class="fm-kv"><span>${isFlow ? '월 합계' : '잔액 합계'}</span><b style="color:${q.color}">${formatWon(total)}</b></div>
    ${series ? `<div class="fm-sub" style="margin-top:10px;">
      <div class="fm-sub-h">최근 ${series.values.length}개월 추이</div>
      ${fmSpark(series.values, q.color, series.labels || series.keys)}
    </div>` : ''}
    ${all.length ? `<ul class="fm-ins">${all.map(x => `<li class="${x.tone}">${x.text}</li>`).join('')}</ul>` : ''}
    ${items.length ? `<div class="fm-sub">
      <div class="fm-sub-h">구성</div>
      ${items.map(x => {
        const amt = Number(x.amount) || 0;
        const pct = total ? (amt / total) * 100 : 0;
        return `<div class="fm-sub-row">
          <span class="nm">${x.name}</span>
          <span class="bar"><i style="width:${pct}%;background:${q.color}"></i></span>
          <span class="vl">${formatCompactWon(amt)}<em style="font-style:normal;color:var(--text-faint);margin-left:5px;">${pct.toFixed(0)}%</em></span>
        </div>`;
      }).join('')}
    </div>` : '<div class="empty-state" style="padding:12px 0;">항목이 없어요.</div>'}
  `;
}

function renderFmDetail(data, d) {
  const host = document.getElementById('fm-detail');
  if (!host) return;
  const fm = flowmapData();
  const sel = state.fmSel;
  const item = (sel && sel.id) ? (fm[sel.quad] || []).find(x => x.id === sel.id) : null;

  const mIn = fm.income.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const mOut = fm.expense.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const assetSum = fm.asset.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const liaSum = fm.liability.reduce((a, x) => a + (Number(x.amount) || 0), 0);

  /* 칸 전체가 선택된 경우 */
  if (sel && sel.whole) { host.innerHTML = fmQuadPanel(data, d, sel.quad); return; }

  if (!item) {
    host.innerHTML = `
      <div class="fm-dt-h"><b>전체 요약</b></div>
      <div class="fm-sum">
        <div class="stat-card"><div class="label">월 현금흐름</div><div class="value" style="color:${mIn - mOut >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatCompactWon(mIn - mOut)}원</div><div class="sub">수입 ${formatCompactWon(mIn)} − 지출 ${formatCompactWon(mOut)}</div></div>
        <div class="stat-card"><div class="label">순자산</div><div class="value">${formatCompactWon(assetSum - liaSum)}원</div><div class="sub">자산 ${formatCompactWon(assetSum)} − 부채 ${formatCompactWon(liaSum)}</div></div>
      </div>
      <ul class="fm-ins">
        ${mIn ? `<li class="${mIn > mOut ? 'good' : 'warn'}">저축률 <b>${(((mIn - mOut) / mIn) * 100).toFixed(0)}%</b> — 버는 돈의 ${((mOut / mIn) * 100).toFixed(0)}%가 나갑니다</li>` : ''}
        ${mOut ? `<li>지금 자산으로 소득이 끊겨도 <b>${(assetSum / mOut).toFixed(1)}개월</b> 버팁니다</li>` : ''}
        ${liaSum ? `<li class="warn">부채 ${formatCompactWon(liaSum)}원 — 자산의 ${((liaSum / (assetSum || 1)) * 100).toFixed(0)}%</li>` : '<li class="good">부채 없음</li>'}
      </ul>
      <div class="settings-note">칸 제목을 누르면 그 칸 전체, 항목을 누르면 항목별 인사이트가 여기 뜹니다.</div>`;
    return;
  }
  const q = FM_QUADS.find(x => x.key === sel.quad);
  host.innerHTML = `
    <div class="fm-dt-h">
      <b style="color:${q.color}">${item.name}</b>
      <div style="display:flex;gap:6px;">
        <button class="btn small" id="fm-edit">편집</button>
        <button class="btn small danger" id="fm-del">삭제</button>
      </div>
    </div>
    <div class="fm-kv"><span>구분</span><b>${q.label}</b></div>
    <div class="fm-kv"><span>${sel.quad === 'income' || sel.quad === 'expense' ? '월 금액' : '잔액'}</span><b>${item.amount ? formatWon(item.amount) : '—'}</b></div>
    ${item.tag ? `<div class="fm-kv"><span>태그</span><b>${item.tag}</b></div>` : ''}
    ${item.linkedTo ? `<div class="fm-kv"><span>연결</span><b>${item.linkedTo}</b></div>` : ''}
    ${item.memo ? `<div class="fm-memo">${item.memo.replace(/</g, '&lt;')}</div>` : ''}
    ${(() => {
      const goodUp = sel.quad === 'income' || sel.quad === 'asset';
      const series = sel.quad === 'liability' ? null : fmSeriesFor(data, d, sel.quad, item.name);
      if (!series || !series.values.some(x => x)) return '';
      const ins = fmInsights(series, { goodUp });
      const shareOf = (() => {
        const tot = (fm[sel.quad] || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
        return tot ? ((Number(item.amount) || 0) / tot) * 100 : null;
      })();
      return `<div class="fm-sub">
        <div class="fm-sub-h">최근 ${series.values.length}개월 추이</div>
        ${fmSpark(series.values, q.color, series.labels || series.keys)}
      </div>
      <ul class="fm-ins">
        ${shareOf !== null ? `<li>${FM_QUADS.find(x => x.key === sel.quad).label} 안에서 비중 <b>${shareOf.toFixed(0)}%</b></li>` : ''}
        ${ins.map(x => `<li class="${x.tone}">${x.text}</li>`).join('')}
      </ul>`;
    })()}
    ${(() => {
      const bd = flowBreakdown(data, d, sel.quad, item.name);
      if (!bd) return sel.quad === 'income' || sel.quad === 'expense'
        ? '<div class="fm-sub"><div class="fm-sub-h">세부 항목</div><div class="empty-state" style="padding:10px 0;font-size:11.5px;">가계부에서 이 이름과 맞는 내역을 찾지 못했어요.</div></div>'
        : '';
      const max = Math.max(...bd.list.map(x => Math.abs(x.avg)), 1);
      return `<div class="fm-sub">
        <div class="fm-sub-h">세부 항목 · 최근 ${bd.months}개월 월평균 (${bd.level === 'item' ? '항목별' : '사용처별'})</div>
        ${bd.list.map(x => `<div class="fm-sub-row">
          <span class="nm">${x.name}</span>
          <span class="bar"><i style="width:${Math.min(Math.abs(x.avg) / max * 100, 100)}%;background:${q.color}"></i></span>
          <span class="vl">${formatCompactWon(Math.round(x.avg))}</span>
        </div>`).join('')}
        <div class="fm-sub-row" style="border-top:1px solid var(--border-strong);margin-top:2px;">
          <span class="nm" style="color:var(--text)">합계</span><span class="bar"></span>
          <span class="vl" style="color:${q.color}">${formatCompactWon(Math.round(bd.total))}</span>
        </div>
      </div>`;
    })()}
  `;
  const ed = document.getElementById('fm-edit');
  if (ed) ed.addEventListener('click', () => openFlowItemEditor(sel.quad, item.id));
  const dl = document.getElementById('fm-del');
  if (dl) dl.addEventListener('click', async () => {
    const fm2 = flowmapData();
    fm2[sel.quad] = fm2[sel.quad].filter(x => x.id !== item.id);
    state.fmSel = null;
    await saveSettings();
    renderPage();
  });
}

function openFlowItemEditor(quad, id) {
  const fm = flowmapData();
  const q = FM_QUADS.find(x => x.key === quad);
  const cur = id ? (fm[quad] || []).find(x => x.id === id) : null;
  const isFlow = quad === 'income' || quad === 'expense';
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head"><b>${q.label} — ${cur ? '항목 편집' : '항목 추가'}</b><button class="btn small" data-act="close">닫기</button></div>
      <div class="modal-body">
        <label class="fld"><span>이름</span><input type="text" id="fm-name" value="${cur ? (cur.name || '').replace(/"/g, '&quot;') : ''}" placeholder="${quad === 'income' ? '예) 급여' : quad === 'expense' ? '예) 신용카드 사용액' : quad === 'asset' ? '예) 토스 증권' : '예) 학자금 대출'}" /></label>
        <div class="fld-row">
          <label class="fld"><span>${isFlow ? '월 금액 (원)' : '잔액 (원)'}</span><input type="text" inputmode="numeric" id="fm-amount" value="${cur && cur.amount ? wonComma(cur.amount) : ''}" /></label>
          <label class="fld"><span>태그 (선택)</span><input type="text" id="fm-tag" value="${cur ? (cur.tag || '').replace(/"/g, '&quot;') : ''}" placeholder="예) 고정비 / 근로" /></label>
        </div>
        <label class="fld"><span>연결 (선택) — 이 항목이 어디로 흘러가는지</span><input type="text" id="fm-link" value="${cur ? (cur.linkedTo || '').replace(/"/g, '&quot;') : ''}" placeholder="예) 급여 → 토스 증권" /></label>
        <label class="fld"><span>상세</span><textarea id="fm-memo" rows="5" style="background:var(--panel-2);border:1px solid var(--border-strong);color:var(--text);font-family:var(--sans);font-size:13px;border-radius:7px;padding:8px 10px;width:100%;resize:vertical;">${cur ? (cur.memo || '') : ''}</textarea></label>
      </div>
      <div class="modal-foot">
        ${cur ? '<button class="btn small danger" data-act="delete">삭제</button>' : '<span></span>'}
        <div style="display:flex;gap:8px;">
          <button class="btn small" data-act="close">취소</button>
          <button class="btn small primary" data-act="save">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener('click', async (e) => {
    if (e.target === back) { back.remove(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'close') { back.remove(); return; }
    if (a === 'delete') {
      fm[quad] = fm[quad].filter(x => x.id !== id);
      if (state.fmSel && state.fmSel.id === id) state.fmSel = null;
      await saveSettings(); back.remove(); renderPage(); return;
    }
    if (a === 'save') {
      const g = (i) => (document.getElementById(i) || {}).value || '';
      const name = g('fm-name').trim();
      if (!name) { back.remove(); return; }
      const obj = {
        id: id || uid(),
        name,
        amount: Number(String(g('fm-amount')).replace(/[^0-9.-]/g, '')) || 0,
        tag: g('fm-tag').trim(),
        linkedTo: g('fm-link').trim(),
        memo: g('fm-memo')
      };
      if (id) fm[quad] = fm[quad].map(x => x.id === id ? obj : x);
      else fm[quad].push(obj);
      state.fmSel = { quad, id: obj.id };
      await saveSettings();
      back.remove();
      renderPage();
    }
  });
}

/* 가계부·자산 스냅샷에서 흐름표 초안을 만들어 준다 (기존 항목은 유지, 이름이 겹치면 건너뜀) */
async function seedFlowMap(data, d) {
  const fm = flowmapData();
  const has = (k, n) => fm[k].some(x => x.name === n);
  const push = (k, name, amount, memo, tag) => { if (!has(k, name)) fm[k].push({ id: uid(), name, amount: Math.round(amount) || 0, tag: tag || '', linkedTo: '', memo: memo || '' }); };

  const i = d.latestPivotIdx;
  const last6 = (arr) => { const v = (arr || []).slice(Math.max(0, i - 5), i + 1).filter(x => x !== undefined); return v.length ? v.reduce((a, b) => a + (b || 0), 0) / v.length : 0; };

  Object.entries(data.incomeCategories || {}).forEach(([k, v]) => {
    const avg = last6(v);
    if (avg > 0) push('income', k, avg, `최근 6개월 월평균 ${formatWon(Math.round(avg))}`, '수입');
  });
  Object.entries(data.expenseCategories || {}).forEach(([k, v]) => {
    const avg = last6(v);
    if (avg > 0) push('expense', k, avg, `최근 6개월 월평균 ${formatWon(Math.round(avg))}`, '지출');
  });
  const accounts = {};
  (data.assetRows || []).filter(r => r.date === d.latestMonth && r.amount !== null).forEach(r => {
    accounts[r.account] = { amt: (accounts[r.account] ? accounts[r.account].amt : 0) + r.amount, cat: r.category };
  });
  Object.entries(accounts).sort((a, b) => b[1].amt - a[1].amt).forEach(([n, v]) => {
    push('asset', n, v.amt, `${d.latestMonth} 잔액`, v.cat);
  });
  (state.settings.debts || []).forEach(x => push('liability', x.name, x.balance, x.memo || '', '부채'));

  await saveSettings();
  renderPage();
}


function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="site-header" id="site-header">
      <div class="topbar">
        <div class="brand" id="brand-home" role="link" tabindex="0" title="홈으로">
          <span class="mark">🦦</span>
          <h1>해달</h1>
          <span class="tagline">당신의 자산관리 파트너</span>
        </div>
        <div class="sync-box">
          <button class="nav-act accent" id="entry-btn" title="가계부 기록 (N)">＋ 기록<kbd>N</kbd></button>
          <button class="hdr-btn" id="signout-btn">로그아웃</button>
        </div>
      </div>
      <div id="banner-slot"></div>
      <div class="navrow">
        <nav class="navbar" id="navbar"></nav>
      </div>
    </div>
    <div class="site-layout">
      <aside class="railnav" id="railnav"></aside>
      <div class="site-main">
        <div class="page-head" id="page-head"></div>
        <div id="page-content"></div>
        <div class="footer"></div>
      </div>
    </div>
  `;
  document.getElementById('entry-btn').addEventListener('click', () => enOpen());
  /* 타이틀(아이콘·'해달')을 누르면 어디서든 홈으로 */
  const brand = document.getElementById('brand-home');
  const goHome = () => {
    const ov = document.getElementById('en-ov');
    if (ov && !ov.hidden) enClose();
    goTo('home', 'main');
  };
  brand.addEventListener('click', goHome);
  brand.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
  });
  document.getElementById('signout-btn').addEventListener('click', enSignOut);
  document.getElementById('navbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    goTo(btn.dataset.page, btn.dataset.sub);
  });
  document.getElementById('railnav').addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-btn');
    if (!btn) return;
    goTo(state.page, btn.dataset.sub);
  });
  renderNav();
  rcInit();
  enSyncHeaderOffset();
}

function renderBanner() {
  const slot = document.getElementById('banner-slot');
  if (!slot) return;
  if (!state.data && state.lastError) {
    slot.innerHTML = `
      <div class="banner err" style="align-items:flex-start;">
        <span>⚠ 데이터를 불러오지 못했어요. (${enEsc(state.lastError)})</span>
        <button class="btn small" id="retry-btn" style="margin-left:auto;flex-shrink:0;">다시 시도</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => fetchLive(true));
  } else if (state.source === 'live' && state.lastError) {
    slot.innerHTML = `
      <div class="banner" style="align-items:flex-start;">
        <span>ℹ️ ${state.lastError}</span>
        <button class="btn small" id="retry-btn" style="margin-left:auto;flex-shrink:0;">다시 시도</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => fetchLive(true));
  } else {
    slot.innerHTML = '';
  }
}

function destroyPageCharts() {
  Object.values(state.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
  state.charts = {};
}

/* 이번 달 자산 스냅샷이 아직 비어 있으면 탭에 빨간 점을 띄운다.
   달이 바뀌면(1일부터) 자동으로 켜지고, 그 달 값을 한 줄이라도 넣으면 사라진다. */
function snapNeedsInput() {
  const rows = (state.data && state.data.assetRows) || [];
  if (!rows.length) return false;
  const now = new Date();
  const k = now.getFullYear() * 100 + (now.getMonth() + 1);
  return !rows.some(r => assetMonthKey(r.date) === k);
}
function navNeedsDot(section, sub) {
  return section === 'entry' && sub === 'snapshot' && snapNeedsInput();
}

function renderNav() {
  const bar = document.getElementById('navbar');
  if (!bar) return;
  /* 상단에는 최상위 개념만 둔다. 하위는 좌측 레일이 맡는다. */
  bar.innerHTML = NAV_ITEMS.map(n => {
    const on = n.id === state.page;
    const v = currentSub(n.id) || ((SECTION_SUBS[n.id] || []).filter(x => x[0] !== '#')[0] || ['main'])[0];
    return `<button class="nav-btn${on ? ' active' : ''}" data-page="${n.id}" data-sub="${v}">${n.label}${
      navSectionDot(n.id) ? '<span class="nav-dot" title="이번 달 자산 스냅샷이 아직 비어 있어요"></span>' : ''}</button>`;
  }).join('');
  renderSubNav();
}

/* 하위가 하나뿐인 섹션(홈·투자·목표)은 레일을 접어 본문을 넓게 쓴다. */
function renderSubNav() {
  const el = document.getElementById('railnav');
  if (!el) return;
  const n = NAV_ITEMS.find(x => x.id === state.page);
  const subs = SECTION_SUBS[state.page] || [];
  const layout = document.querySelector('.site-layout');
  if (!n || n.solo || subs.filter(x => x[0] !== '#').length < 2) {
    el.innerHTML = '';
    if (layout) layout.classList.add('no-rail');
    return;
  }
  if (layout) layout.classList.remove('no-rail');
  const cur = currentSub(state.page);
  /* ['#', '기간별'] 처럼 v 가 '#' 이면 항목이 아니라 묶음 제목이다. */
  el.innerHTML = subs.map(([v, l]) => v === '#'
    ? `<div class="sub-cat">${l}</div>`
    : `<button class="sub-btn${v === cur ? ' on' : ''}" data-sub="${v}">${l}${
        navNeedsDot(state.page, v) ? '<span class="nav-dot"></span>' : ''}</button>`).join('');
}

/* 섹션 버튼에 점을 찍을지 — 하위 중 하나라도 알림이 있으면 */
function navSectionDot(sec) {
  return (SECTION_SUBS[sec] || []).some(([v]) => v !== '#' && navNeedsDot(sec, v));
}

function renderPage() {
  if (!state.data) {
    /* 첫 로딩이 끝나기 전(또는 실패)에는 옛 숫자 대신 빈 자리만 보여준다 */
    const body0 = document.getElementById('page-content');
    renderNav();
    if (body0) body0.innerHTML = state.lastError
      ? '<div class="empty-state" style="padding:48px 0;text-align:center;opacity:.7;">데이터를 불러오지 못했어요. 위의 ‘다시 시도’를 눌러 주세요.</div>'
      : '<div class="empty-state" style="padding:48px 0;text-align:center;opacity:.7;">불러오는 중…</div>';
    return;
  }
  const _now = new Date();
  const _nowKey = _now.getFullYear() * 100 + (_now.getMonth() + 1);
  const raw = state.data;
  /* 미래(오늘 이후) 자산 스냅샷 행은 화면 전체에서 제외 */
  const data = { ...raw, assetRows: (raw.assetRows || []).filter(r => assetMonthKey(r.date) <= _nowKey) };
  const d = computeDerived(data);
  destroyPageCharts();
  const body = document.getElementById('page-content');
  const section = NAV_ITEMS.some(n => n.id === state.page) ? state.page : 'home';
  state.page = section;
  const SUB = currentSub(section);
  routeWrite(section, SUB);
  renderNav();
  body.innerHTML = '';

  /* 하위로 들어왔으면 어디인지 한 줄로 알려준다. 상단 메뉴만으로는 모른다.
     각 렌더러가 page-content 를 통째로 덮어쓰므로 제목은 그 바깥에 둔다. */
  const head = document.getElementById('page-head');
  if (head) {
    const subsAll = SECTION_SUBS[section] || [];
    const label = (subsAll.find(x => x[0] === SUB) || [])[1];
    const nItem = NAV_ITEMS.find(x => x.id === section);
    /* 화면 스스로 기간(연도·연도/월)을 크게 띄우는 곳은 제목을 겹쳐 달지 않는다 */
    const selfTitled = section === 'report' && (SUB === 'monthly' || SUB === 'yearly');
    const show = label && !selfTitled && !(nItem && nItem.solo) && subsAll.filter(x => x[0] !== '#').length > 1;
    head.textContent = show ? label : '';
    head.hidden = !show;
  }

  if (section === 'home') {
    renderHomePage(body, data, d);

  } else if (section === 'entry') {
    if (SUB === 'snapshot') renderSnapshotPage(body);
    else if (SUB === 'calendar') renderEntryPane(body, data, d, 'calendar');
    else renderEntryPane(body, data, d, 'list');

  } else if (section === 'invest') {
    renderInvestmentPage(body, data, d);

  } else if (section === 'goals') {
    body.innerHTML = '<div id="home-goals"></div>';
    renderGoalBoard(data, d, SUB);

  } else if (section === 'report') {
    if (SUB === 'yearly') renderYearPage(body, data, d);
    else if (SUB === 'networth') renderAssetsPage(body, data, d);
    else if (SUB === 'pension') renderSavingsPage(body, data, d, 'pension');
    else if (SUB === 'savings') renderSavingsPage(body, data, d, 'saving');
    else renderNowPage(body, data, d);

  } else if (section === 'lab') {
    if (SUB === 'explore') renderExplorePage(body);
    else if (SUB === 'flowmap') renderFlowMapPage(body, data, d);
    else if (SUB === 'fixed') renderFixedPage(body);
    else renderStructurePage(body, data, d);

  } else {
    if (SUB === 'budget') renderBudgetSettings(body, data, d);
    else if (SUB === 'saving') renderSavingPlanSettings(body, data, d);
    else dbmRenderFor(body, SUB);
  }
}

/* 입출금 — 목록과 캘린더는 좌측 메뉴로 갈린다. 기록 버튼만 공통으로 얹는다. */
function renderEntryPane(body, data, d, view) {
  body.innerHTML = '<div id="entry-body"></div>';
  const host = document.getElementById('entry-body');
  if (view === 'calendar') renderCalendarPage(host, data, d);
  else renderLedgerShell(host);
}
