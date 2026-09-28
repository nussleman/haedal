/* ---------------- page: 홈 ---------------- */


/* ---------------- 목표 보드 (연도/반기 그리드 · 드래그 이동) ---------------- */

/* "2026 상반기" / "26년 하반기" / "2026 H1" / "2026 3분기" / "2026" 등을 {y, h}로 */
function parseGoalPeriod(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return null;
  const ym = s0.match(/(20\d{2}|\d{2})\s*년?/);
  if (!ym) return null;
  let y = parseInt(ym[1], 10);
  if (y < 100) y += 2000;
  let h = null;
  if (/상반기|상반|H1|1H/i.test(s0)) h = 1;
  else if (/하반기|하반|H2|2H/i.test(s0)) h = 2;
  else {
    const q = s0.match(/([1-4])\s*(?:분기|Q)/i) || s0.match(/Q\s*([1-4])/i);
    if (q) h = parseInt(q[1], 10) <= 2 ? 1 : 2;
  }
  return { y, h };
}

/* 시트에 이미 쓰인 표기 스타일을 최대한 따라간다 */
function goalPeriodFormatter(goals) {
  let useYearSuffix = false, useShortYear = false;
  for (const g of goals) {
    const p = String(pickGoalField(g, 'period') || '');
    if (/\d\s*년/.test(p)) useYearSuffix = true;
    if (/^\s*\d{2}\s*년/.test(p)) useShortYear = true;
  }
  return (y, h) => {
    const yy = useShortYear ? String(y).slice(2) : String(y);
    const head = useYearSuffix ? `${yy}년` : yy;
    return h ? `${head} ${h === 1 ? '상' : '하'}반기` : head;
  };
}


function renderGoalBoard(data, d, view) {
  const host = document.getElementById('home-goals');
  if (!host) return;
  const allGoals = (data.goals || []).filter(g => pickGoalField(g, 'title'));
  if (!allGoals.length) {
    host.innerHTML = `<div class="g"><div class="panel s8">
      <div class="panel-title"><div>목표</div></div>
      <div class="empty-state">아직 자산관리 목표가 없어요.</div>
    </div></div>`;
    return;
  }

  const extra = goalMetricExtra(data, d);
  const fmtPeriod = goalPeriodFormatter(allGoals);

  /* 로컬 이동 오버라이드 (시트 반영 전/실패 시에도 화면에 유지) */
  if (!state.goalMoves) state.goalMoves = {};
  const periodOf = (g) => state.goalMoves[g.__row] !== undefined
    ? state.goalMoves[g.__row]
    : (pickGoalField(g, 'period') || '');

  const hideCat = false, draggable = false;
  const card = (g) => {
    const title = pickGoalField(g, 'title');
    const category = pickGoalField(g, 'category');
    const status = pickGoalField(g, 'status');
    const memo = pickGoalField(g, 'memo');
    const doneDate = pickGoalField(g, 'doneDate');
    const vClass = goalStatusClass(status) || 'pending';
    /* 완료 = 초록 체크·취소선, 대기 = 점선 테두리·흐림 (둘을 다르게 보이게) */
    const progress = goalProgressOf(g, d, extra);
    const freq = pickGoalField(g, 'freq');
    const sanity = goalSanityFlag(progress);

    let metricHtml = '';
    if (progress) {
      const good = progress.invert ? progress.current <= progress.target : progress.current >= progress.target;
      const fmt = (v) => progress.isPct ? `${v.toFixed(1)}%` : `${formatCompactWon(v)}원`;
      /* 달성률: 많을수록 좋은 목표는 현재/목표, 적을수록 좋은 목표는 목표/현재 */
      const raw = progress.invert
        ? (progress.current > 0 ? (progress.target / progress.current) * 100 : 100)
        : (progress.target > 0 ? (progress.current / progress.target) * 100 : 0);
      const pct = Math.max(0, Math.min(raw, 100));
      const gap = progress.current - progress.target;
      const dirIcon = progress.invert ? '↓' : '↑';
      const gapTxt = gap === 0 ? '목표와 동일'
        : progress.invert
          ? (gap < 0 ? `${fmt(Math.abs(gap))} 아래` : `${fmt(gap)} 초과`)
          : (gap >= 0 ? `${fmt(gap)} 초과` : `${fmt(Math.abs(gap))} 남음`);
      metricHtml = `
        <div class="gb-metric ${good ? 'good' : 'bad'}">
          <span class="gb-dir" title="${progress.invert ? '적을수록 좋은 목표' : '많을수록 좋은 목표'}">${dirIcon}</span>
          <span class="gb-cur">${fmt(progress.current)}</span>
          <span class="gb-arrow">/</span>
          <span class="gb-tgt">${fmt(progress.target)}</span>
          <span class="gb-verdict">${good ? '달성' : '미달'}</span>
          ${progress.overridden ? '<span class="gb-ov" title="목표 수치 직접 지정">✎</span>' : ''}
        </div>
        <div class="gb-bar"><i class="${good ? 'good' : 'bad'}" style="width:${pct}%"></i></div>
        <div class="gb-figs"><span>${progress.name}</span><span>${gapTxt}</span></div>
        ${sanity ? `<div class="gb-warn">⚠ ${sanity}</div>` : ''}`;
    }

    const pending = state.goalMoves[g.__row] !== undefined || (state.goalEdits && state.goalEdits[g.__row]);
    return `<div class="gb-card ${vClass}" ${draggable ? 'draggable="true"' : ''} data-row="${g.__row}" title="더블클릭 → 편집">
      <div class="gb-head">
        ${vClass === 'ok' ? '<span class="gb-check">✓</span>' : ''}
        <span class="gb-title">${title}${freq ? `<em class="gb-freq">${freq}</em>` : ''}</span>
      </div>
      ${metricHtml}
      <div class="gb-foot">
        ${status ? `<span class="gb-status ${vClass}">${status}</span>` : ''}
        ${!hideCat && category ? `<span class="gb-tag">${category}</span>` : ''}
        ${doneDate ? `<span class="gb-date">${doneDate}</span>` : ''}
        ${!progress ? '<span class="gb-nolink">수치 미연동</span>' : ''}
        ${pending ? '<span class="gb-pending">저장 중</span>' : ''}
      </div>
      ${memo ? `<div class="gb-memo">${memo}</div>` : ''}
    </div>`;
  };

  renderGoalViews(host, 'list', { allGoals, card, d, extra, data, fmtPeriod, periodOf });
}


/* ---------------- 목표: 목록 ----------------
   상태는 시트 '상태' 칸으로 가른다 — 진행 = 진행중, 완료·달성 = 달성,
   나머지(대기·예정·보류·지연·비어 있음)는 아직 손대지 않은 '다음 할 것'. */
const GOAL_VIEW_NOTE = {
  active: '지금 붙잡고 있는 목표',
  done: '다 이룬 목표 — 최근에 달성한 순',
  next: '아직 시작하지 않은 목표 — 시기가 가까운 순',
  all: '머리글을 누르면 정렬, 줄을 더블클릭하면 편집'
};
function goalBucketOf(g) {
  const c = goalStatusClass(pickGoalField(g, 'status'));
  return c === 'ok' ? 'done' : c === 'active' ? 'active' : 'next';
}

function renderGoalViews(host, view, ctx) {
  const { allGoals, card, d, extra, data, fmtPeriod, periodOf } = ctx;
  const cnt = { active: 0, done: 0, next: 0 };
  allGoals.forEach(g => { cnt[goalBucketOf(g)]++; });

  /* 시기 → 정렬 키 (없으면 맨 뒤) */
  const periodKey = (g) => {
    const p = parseGoalPeriod(periodOf(g));
    return p ? p.y * 10 + (p.h || 0) : 1e9;
  };
  const doneKey = (g) => String(pickGoalField(g, 'doneDate') || '').replace(/[^\d]/g, '');
  /* 달성률 (0~100+). 수치 연동이 안 된 목표는 null */
  const pctOf = (g) => {
    const p = goalProgressOf(g, d, extra);
    if (!p) return null;
    return p.invert
      ? (p.current > 0 ? (p.target / p.current) * 100 : 100)
      : (p.target > 0 ? (p.current / p.target) * 100 : 0);
  };
  const byTitle = (a, b) => String(pickGoalField(a, 'title')).localeCompare(String(pickGoalField(b, 'title')), 'ko');

  const grid = (list, empty) => list.length
    ? `<div class="gv-grid">${list.map(card).join('')}</div>`
    : `<div class="empty-state">${empty}</div>`;

  /* 목록: 예전 진행중·달성·다음·전체 4개 화면을 하나로 — 위 칩으로 거르고, 카드/표로 바꿔 본다 */
  const F = ['all', 'active', 'done', 'next'].includes(state.goalFilter) ? state.goalFilter : 'active';
  const DSP = state.goalDisplay === 'table' ? 'table' : 'card';
  const inF = (g) => F === 'all' || goalBucketOf(g) === F;
  const EMPTY = { all: '목표가 없어요.', active: '진행 중인 목표가 없어요.', done: '아직 달성한 목표가 없어요.',
    next: '다음에 할 목표가 없어요.' };

  let body = '';
  if (DSP === 'card') {
    const list = allGoals.filter(inF);
    const bo = { active: 0, next: 1, done: 2 };
    if (F === 'done') list.sort((a, b) => doneKey(b).localeCompare(doneKey(a)) || byTitle(a, b));
    else if (F === 'next') list.sort((a, b) => periodKey(a) - periodKey(b) || byTitle(a, b));
    else list.sort((a, b) => bo[goalBucketOf(a)] - bo[goalBucketOf(b)]
      || (pctOf(b) ?? -1) - (pctOf(a) ?? -1) || periodKey(a) - periodKey(b));
    body = grid(list, EMPTY[F]);

  } else {
    /* 전체 목록 표 */
    const COLS = [
      ['period', '시기', g => periodKey(g)],
      ['category', '구분', g => pickGoalField(g, 'category') || ''],
      ['title', '항목', g => pickGoalField(g, 'title') || ''],
      ['freq', '기간', g => pickGoalField(g, 'freq') || ''],
      ['target', '목표', g => { const p = goalProgressOf(g, d, extra); return p ? p.target : -Infinity; }],
      ['current', '현재', g => { const p = goalProgressOf(g, d, extra); return p ? p.current : -Infinity; }],
      ['pct', '달성률', g => pctOf(g) ?? -1],
      ['status', '상태', g => ({ active: 0, next: 1, done: 2 })[goalBucketOf(g)]],
      ['doneDate', '달성한 날', g => doneKey(g)],
      ['memo', '메모', g => pickGoalField(g, 'memo') || '']
    ];
    const srt = state.goalTblSort && COLS.some(c => c[0] === state.goalTblSort.k)
      ? state.goalTblSort : { k: 'status', dir: 1 };
    const getter = COLS.find(c => c[0] === srt.k)[2];
    const rows = allGoals.filter(inF).sort((a, b) => {
      const x = getter(a), y = getter(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return c * srt.dir || periodKey(a) - periodKey(b) || byTitle(a, b);
    });
    const fmtOf = (p, v) => p.isPct ? `${v.toFixed(1)}%` : `${formatCompactWon(v)}원`;
    body = !rows.length ? `<div class="empty-state">${EMPTY[F]}</div>` : `<div class="panel gv-tblwrap"><table class="data-table gv-tbl">
      <thead><tr>${COLS.map(([k, l]) => `<th data-gsort="${k}" class="${k === srt.k ? 'on' : ''}">${l}${
        k === srt.k ? (srt.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(g => {
        const p = goalProgressOf(g, d, extra);
        const pct = pctOf(g);
        const good = p ? (p.invert ? p.current <= p.target : p.current >= p.target) : null;
        const st = pickGoalField(g, 'status');
        const vc = goalStatusClass(st) || 'pending';
        return `<tr data-row="${g.__row}">
          <td class="c-date">${periodOf(g) || '—'}</td>
          <td>${pickGoalField(g, 'category') ? `<span class="gb-tag">${pickGoalField(g, 'category')}</span>` : ''}</td>
          <td class="gv-title">${pickGoalField(g, 'title')}</td>
          <td>${pickGoalField(g, 'freq') || ''}</td>
          <td class="amt">${p ? fmtOf(p, p.target) : (pickGoalField(g, 'amount') || '—')}</td>
          <td class="amt">${p ? fmtOf(p, p.current) : '—'}</td>
          <td class="amt ${good === null ? '' : good ? 'income' : 'expense'}">${pct === null ? '—' : Math.round(pct) + '%'}</td>
          <td>${st ? `<span class="gb-status ${vc}">${st}</span>` : ''}</td>
          <td class="c-date">${pickGoalField(g, 'doneDate') || ''}</td>
          <td class="gv-memo">${pickGoalField(g, 'memo') || ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  host.innerHTML = `
    <div class="gv-bar">
      <div class="gv-filter" id="goal-filter">${[['active', '진행중'], ['next', '다음'], ['done', '달성'], ['all', '전체']]
        .map(([k, l]) => `<button data-gf="${k}" class="${k === F ? 'on' : ''} ${k === 'done' ? 'ok' : k}">${l}<b>${k === 'all' ? allGoals.length : cnt[k]}</b></button>`).join('')}</div>
      <div class="range-toggle" id="goal-display">
        <button data-gd="card" class="${DSP === 'card' ? 'active' : ''}">카드</button>
        <button data-gd="table" class="${DSP === 'table' ? 'active' : ''}">표</button>
      </div>
      <span class="settings-note gv-note" style="margin:0;">${DSP === 'table' ? GOAL_VIEW_NOTE.all : (F === 'all' ? '진행중 → 다음 → 달성 순' : GOAL_VIEW_NOTE[F]) + ' · 더블클릭 → 편집'}</span>
      <button class="btn small" id="goal-add-btn">+ 목표 추가</button>
    </div>
    <div id="goal-views">${body}</div>`;

  document.getElementById('goal-add-btn').addEventListener('click', () => openGoalEditor(null, data, d, fmtPeriod));
  const box = document.getElementById('goal-views');
  box.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.gb-card, tr[data-row]');
    if (!c) return;
    const g = allGoals.find(x => String(x.__row) === c.dataset.row);
    if (g) openGoalEditor(g, data, d, fmtPeriod);
  });
  host.querySelectorAll('[data-gf]').forEach(b => b.addEventListener('click', () => { state.goalFilter = b.dataset.gf; renderPage(); }));
  host.querySelectorAll('[data-gd]').forEach(b => b.addEventListener('click', () => { state.goalDisplay = b.dataset.gd; renderPage(); }));
  box.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-gsort]');
    if (!th) return;
    const k = th.dataset.gsort;
    const cur = state.goalTblSort || { k: 'status', dir: 1 };
    state.goalTblSort = { k, dir: cur.k === k ? -cur.dir : 1 };
    renderPage();
  });
}

/* ---------------- 목표 편집기 (더블클릭 / 추가) ---------------- */

const GOAL_STATUS_OPTIONS = ['진행중', '대기', '완료', '보류'];

function goalFieldKeyFor(goal, alias) {
  const names = GOAL_FIELD_ALIASES[alias] || [];
  for (const n of names) if (goal && goal[n] !== undefined) return n;
  return names[0];
}

function openGoalEditor(goal, data, d, fmtPeriod) {
  const isNew = !goal;
  const g = goal || {};
  const extra = goalMetricExtra(data, d);
  const cats = [...new Set((data.goals || []).map(x => pickGoalField(x, 'category')).filter(Boolean))];
  const items = [...new Set((data.goals || []).map(x => pickGoalField(x, 'title')).filter(Boolean))];
  const cur = {
    title: pickGoalField(g, 'title') || '',
    period: pickGoalField(g, 'period') || '',
    category: pickGoalField(g, 'category') || '',
    freq: pickGoalField(g, 'freq') || '',
    amount: pickGoalField(g, 'amount') || '',
    status: pickGoalField(g, 'status') || (isNew ? '진행중' : ''),
    memo: pickGoalField(g, 'memo') || ''
  };
  const savedKey = (state.goalMetric || {})[g.__row] || '';

  const nowY = new Date().getFullYear();
  const periodOpts = [];
  for (let y = nowY - 2; y <= nowY + 3; y++) { periodOpts.push([fmtPeriod(y, 1), `${y} 상반기`]); periodOpts.push([fmtPeriod(y, 2), `${y} 하반기`]); }

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <b>${isNew ? '목표 추가' : '목표 편집'}</b>
        <button class="btn small" data-act="close">닫기</button>
      </div>
      <div class="modal-body">
        <div class="fld-row">
          <label class="fld"><span>구분</span><input type="text" id="ge-category" list="ge-cat-list" value="${cur.category.replace(/"/g, '&quot;')}" placeholder="예) 🏦자산" />
            <datalist id="ge-cat-list">${cats.map(c => `<option value="${c}"></option>`).join('')}</datalist>
          </label>
          <label class="fld"><span>항목</span><input type="text" id="ge-title" list="ge-item-list" value="${cur.title.replace(/"/g, '&quot;')}" placeholder="예) 총 자산" />
            <datalist id="ge-item-list">${items.map(c => `<option value="${c}"></option>`).join('')}</datalist>
          </label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>기간</span>
            <select id="ge-freq">
              ${[['', '해당 없음 (잔액·누적)'], ['월', '월'], ['연', '연']].map(([v, l]) => `<option value="${v}" ${v === cur.freq ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label class="fld"><span>금액 or 비율</span>
            <input type="text" inputmode="numeric" id="ge-amount" value="${cur.amount === '' ? '' : String(cur.amount)}" placeholder="예) 10000000 또는 40%" />
          </label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>상태</span>
            <select id="ge-status">
              ${[...new Set([...GOAL_STATUS_OPTIONS, cur.status].filter(Boolean))].map(v => `<option value="${v}" ${v === cur.status ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="fld"><span>시기 (선택)</span>
            <select id="ge-period">
              <option value="">시기 미정</option>
              ${periodOpts.map(([v, l]) => `<option value="${v}" ${v === cur.period ? 'selected' : ''}>${l}</option>`).join('')}
              ${cur.period && !periodOpts.some(([v]) => v === cur.period) ? `<option value="${cur.period}" selected>${cur.period}</option>` : ''}
            </select>
          </label>
        </div>
        <label class="fld"><span>연동 지표 (비우면 구분·항목으로 자동 인식)</span>
          <select id="ge-metric">
            <option value="">자동</option>
            ${GOAL_METRIC_DEFS.map(m => `<option value="${m.key}" ${m.key === savedKey ? 'selected' : ''}>${m.name} (${m.dir === 'up' ? '많을수록 좋음' : '적을수록 좋음'})</option>`).join('')}
          </select>
        </label>
        <label class="fld"><span>메모</span><input type="text" id="ge-memo" value="${cur.memo.replace(/"/g, '&quot;')}" /></label>
        <div class="ge-link" id="ge-link"></div>
      </div>
      <div class="modal-foot">
        ${isNew ? '<span></span>' : '<button class="btn small danger" data-act="delete">삭제</button>'}
        <div style="display:flex;gap:8px;">
          <button class="btn small" data-act="close">취소</button>
          <button class="btn small primary" data-act="save">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  const $ = (id) => back.querySelector('#' + id);

  const draftGoal = () => ({
    __row: g.__row || -1,
    [goalFieldKeyFor(g, 'title')]: $('ge-title').value,
    [goalFieldKeyFor(g, 'category')]: $('ge-category').value,
    [goalFieldKeyFor(g, 'freq')]: $('ge-freq').value,
    [goalFieldKeyFor(g, 'amount')]: $('ge-amount').value
  });

  const refreshLink = () => {
    const draft = draftGoal();
    const key = $('ge-metric').value || null;
    const savedMetric = state.goalMetric || {};
    const prev = savedMetric[draft.__row];
    if (key) savedMetric[draft.__row] = key; else delete savedMetric[draft.__row];
    state.goalMetric = savedMetric;
    const p = goalProgressOf(draft, d, extra);
    if (prev === undefined) delete savedMetric[draft.__row]; else savedMetric[draft.__row] = prev;

    const box = $('ge-link');
    if (!p) {
      box.className = 'ge-link none';
      box.innerHTML = `연동된 수치 없음 — <b>구분</b>과 <b>항목</b>이 인식되지 않거나 <b>금액 or 비율</b>이 비어 있어요.
        (예: 구분 <b>🏦자산</b> · 항목 <b>총 자산</b> · 금액 <b>150000000</b>)`;
      return;
    }
    const good = p.invert ? p.current <= p.target : p.current >= p.target;
    const fmt = (v) => p.isPct ? `${v.toFixed(1)}%` : `${formatCompactWon(v)}원`;
    const sanity = goalSanityFlag(p);
    box.className = `ge-link ${good ? 'good' : 'bad'}`;
    box.innerHTML = `<b>${p.name}</b> · ${p.invert ? '적을수록 좋음' : '많을수록 좋음'}<br/>
      현재 <b>${fmt(p.current)}</b> / 목표 <b>${fmt(p.target)}</b> → <b>${good ? '달성' : '미달'}</b>
      ${sanity ? `<br/><span style="color:var(--accent-text)">⚠ ${sanity}</span>` : ''}`;
  };
  ['ge-title', 'ge-category', 'ge-amount'].forEach(id => $(id).addEventListener('input', refreshLink));
  ['ge-metric', 'ge-freq'].forEach(id => $(id).addEventListener('change', refreshLink));
  refreshLink();

  const close = () => back.remove();
  back.addEventListener('click', (e) => {
    if (e.target === back) return close();
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') return close();
    if (act === 'delete') {
      if (!window.confirm('이 목표를 삭제할까요?')) return;
      pushGoalOp({ action: 'deleteGoal', row: g.__row, title: cur.title });
      state.data.goals = (state.data.goals || []).filter(x => x.__row !== g.__row);
      close(); renderPage();
      return;
    }
    if (act === 'save') {
      const patch = {
        title: $('ge-title').value.trim(),
        category: $('ge-category').value.trim(),
        freq: $('ge-freq').value,
        amount: $('ge-amount').value.trim(),
        period: $('ge-period').value,
        status: $('ge-status').value,
        memo: $('ge-memo').value.trim()
      };
      if (!patch.title) { showToast('항목을 입력해 주세요.', 'warn'); return; }
      if (!state.goalMetric) state.goalMetric = {};
      if (!state.goalTarget) state.goalTarget = {};
      const FIELDS = ['title', 'category', 'freq', 'amount', 'period', 'status', 'memo'];

      if (isNew) {
        const rows = (state.data.goals || []).map(x => x.__row || 0);
        const newRow = (rows.length ? Math.max(...rows) : 1) + 1;
        const obj = { __row: newRow, __local: true };
        FIELDS.forEach(f => { obj[goalFieldKeyFor(null, f)] = patch[f]; });
        state.data.goals = (state.data.goals || []).concat([obj]);
        if ($('ge-metric').value) state.goalMetric[newRow] = $('ge-metric').value;
        pushGoalOp({ action: 'addGoal', tempRow: newRow, ...patch });
      } else {
        FIELDS.forEach(f => { g[goalFieldKeyFor(g, f)] = patch[f]; });
        if (state.goalMoves) delete state.goalMoves[g.__row];
        if ($('ge-metric').value) state.goalMetric[g.__row] = $('ge-metric').value;
        else delete state.goalMetric[g.__row];
        delete state.goalTarget[g.__row];
        pushGoalOp({ action: 'updateGoal', row: g.__row, ...patch });
      }
      close(); renderPage();
    }
  });
}

/* 목표 저장 — goals 테이블에 바로 쓴다. 화면 상태는 호출한 쪽이 먼저 바꿔 둔다. */
function goalPatchToRow(p) {
  const row = {};
  if (p.title !== undefined) row.item = p.title;
  if (p.category !== undefined) row.kind = cleanLabel(p.category) || null;
  if (p.freq !== undefined) row.frequency = p.freq || null;
  if (p.period !== undefined) row.period = p.period || null;
  if (p.status !== undefined) row.status = p.status || null;
  if (p.memo !== undefined) row.note = p.memo || null;
  if (p.amount !== undefined) {
    const t = String(p.amount || '').trim();
    const v = parseGoalAmount(t);
    if (/%$/.test(t)) { row.target_ratio = v; row.target_amount = null; }
    else { row.target_amount = v; row.target_ratio = null; }
  }
  return row;
}
async function pushGoalOp(payload) {
  try {
    const sb = await enClient();
    if (payload.action === 'addGoal') {
      const row = { ...goalPatchToRow(payload), categories: [GOAL_CATEGORY] };
      if (/(완료|달성)/.test(payload.status || '')) row.achieved_on = enToday();
      const { data, error } = await sb.from('goals').insert(row).select('id').single();
      if (error) throw error;
      /* 화면에서 임시 번호로 붙여 둔 카드를 진짜 id 로 바꾼다 */
      const g = (state.data.goals || []).find(x => x.__row === payload.tempRow && x.__local);
      if (g) { g.__row = data.id; delete g.__local; }
      if (state.goalMetric && state.goalMetric[payload.tempRow] !== undefined) {
        state.goalMetric[data.id] = state.goalMetric[payload.tempRow];
        delete state.goalMetric[payload.tempRow];
      }
    } else if (payload.action === 'updateGoal') {
      const row = goalPatchToRow(payload);
      /* 달성일: 완료로 바뀌는 순간만 오늘로 찍고, 이미 있으면 그대로 둔다 */
      if (payload.status !== undefined) {
        const g = (state.data.goals || []).find(x => x.__row === payload.row);
        const done = /(완료|달성)/.test(payload.status || '');
        if (!done) { row.achieved_on = null; if (g) g['달성한 날'] = ''; }
        else if (g && !g['달성한 날']) { row.achieved_on = enToday(); g['달성한 날'] = row.achieved_on; }
      }
      const { error } = await sb.from('goals').update(row).eq('id', payload.row);
      if (error) throw error;
    } else if (payload.action === 'deleteGoal') {
      const { error } = await sb.from('goals').delete().eq('id', payload.row);
      if (error) throw error;
    }
    showToast('목표를 저장했어요.', 'good');
  } catch (e) {
    showToast('목표 저장 실패 — ' + (e.message || e), 'warn');
  }
}

function showToast(msg, kind) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    document.body.appendChild(el);
  }
  el.className = `toast ${kind || ''} on`;
  el.textContent = msg;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = `toast ${kind || ''}`; }, 2600);
}









function renderAllocation(d) {
  const panel = document.getElementById('panel-allocation');
  /* 목표 배분 갭과 같은 축을 쓰려고 4개 실제 카테고리를 그대로 쓴다(연금을 저축에 합치지 않음) */
  const entries = ALLOC_CATS.filter(c => (d.allocation[c] || 0) > 0).map(c => [c, d.allocation[c]]);
  panel.innerHTML = `
    <div class="panel-title">
      <div>자산 배분</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="ptag">${d.latestMonth || ''}</span>
        <button class="btn small" id="alloc-edit">${state.settings.targetAlloc ? '목표 수정' : '목표 설정'}</button>
      </div>
    </div>
    <div id="panel-target-alloc"></div>
  `;
  renderTargetAllocPanel('panel-target-alloc', d);
  const _ae = document.getElementById('alloc-edit');
  if (_ae) _ae.addEventListener('click', () => openAllocEditor(d));
  /* 도넛 조각 위에 카테고리 · % 를 직접 찍는다 */
  const donutLabel = {
    id: 'donutLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1;
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        const v = chart.data.datasets[0].data[i];
        const pct = (v / total) * 100;
        if (pct < 6) return;
        const pos = arc.tooltipPosition();
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0f141d';
        ctx.font = "700 11px 'IBM Plex Mono', monospace";
        ctx.fillText(`${pct.toFixed(0)}%`, pos.x, pos.y);
        ctx.restore();
      });
      /* 가운데 총액 */
      const meta = chart.getDatasetMeta(0).data[0];
      if (!meta) return;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#eae8e0';
      ctx.font = "700 14px 'IBM Plex Mono', monospace";
      ctx.fillText(formatCompactWon(total), meta.x, meta.y);
      ctx.restore();
    }
  };
  const ctx = document.getElementById('chart-alloc');
  state.charts.alloc = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: entries.map(e => e[0].replace(' 자산', '')), datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map(e => CAT_COLORS[e[0]] || '#888'), borderColor: '#171e2b', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${formatCompactWon(c.raw)}원` } } } },
    plugins: [donutLabel]
  });
}

function buildAssetMonthlySeries(assetRows) {
  const catByMonth = {};
  const catTotals = {};
  const accByMonth = {};
  const accTotals = {};
  assetRows.forEach(r => {
    if (r.amount === null) return;
    catByMonth[r.date] = catByMonth[r.date] || {};
    catByMonth[r.date][r.category] = (catByMonth[r.date][r.category] || 0) + r.amount;
    catTotals[r.category] = (catTotals[r.category] || 0) + r.amount;
    accByMonth[r.date] = accByMonth[r.date] || {};
    accByMonth[r.date][r.account] = (accByMonth[r.date][r.account] || 0) + r.amount;
    accTotals[r.account] = (accTotals[r.account] || 0) + r.amount;
  });
  const accounts = Object.entries(accTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  return { catByMonth, catTotals, accByMonth, accounts };
}

function assetMonthToPivotKey(s) {
  const m = (s || '').match(/(\d{2})년\s*(\d{2})월/);
  if (!m) return null;
  return `${2000 + parseInt(m[1])}-${parseInt(m[2])}월`;
}

function renderTrend(data, d) {
  const panel = document.getElementById('panel-trend');
  panel.innerHTML = `
    <div class="panel-title">
      <div>총자산 추이</div>
      <div class="range-toggle" id="asset-trend-range-toggle"></div>
    </div>
    <div class="range-toggle" id="asset-trend-mode-toggle" style="margin-bottom:10px;">
      <button data-mode="total" class="active">총액</button>
      <button data-mode="category">카테고리별</button>
      <button data-mode="account">계좌별</button>
    </div>
    <div class="income-cat-btns" id="asset-trend-filter-btns" style="display:none;"></div>
    <div class="overlay-toggles" id="asset-trend-overlay-toggles" style="display:none;">
      <label><input type="checkbox" id="asset-net-toggle" checked /> 월별 순익 표시</label>
      <label><input type="checkbox" id="asset-cumnet-toggle" /> 누적 순익 표시</label>
    </div>
    <div class="chart-wrap tall"><canvas id="chart-trend"></canvas></div>
    <div class="chart-legend" id="asset-trend-legend"></div>
  `;
  const months = d.assetMonths;
  const series = buildAssetMonthlySeries(data.assetRows);
  const filterBtns = document.getElementById('asset-trend-filter-btns');
  const overlayBox = document.getElementById('asset-trend-overlay-toggles');

  const netByMonth = {};
  months.forEach(m => {
    const pk = assetMonthToPivotKey(m);
    const idx = pk ? data.months.indexOf(pk) : -1;
    netByMonth[m] = idx >= 0 ? (data.incomeTotal[idx] || 0) - (data.expenseTotal[idx] || 0) : 0;
  });
  let cumAcc = 0;
  const cumNetByMonth = {};
  months.forEach(m => { cumAcc += netByMonth[m]; cumNetByMonth[m] = cumAcc; });

  const renderFilterBtns = (options, allLabel) => {
    const cur = state.assetTrendFilter;
    filterBtns.innerHTML = `
      <button data-val="all" class="income-cat-btn ${cur === 'all' ? 'active' : ''}">${allLabel}</button>
      ${options.map(o => `<button data-val="${o}" class="income-cat-btn ${cur === o ? 'active' : ''}">${o}</button>`).join('')}
    `;
    filterBtns.querySelectorAll('.income-cat-btn').forEach(b => {
      b.addEventListener('click', () => {
        state.assetTrendFilter = b.dataset.val;
        drawTrend();
      });
    });
  };

  /* 카테고리·계좌별도 총자산과 같은 부드러운 선(누적 영역)으로 그린다 */
  const hexA = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const lineDs = (label, values, color, stack) => ({
    type: 'line', label, data: values,
    borderColor: color, backgroundColor: hexA(color, stack ? 0.5 : 0.14),
    fill: stack ? '-1' : true, tension: 0.35, pointRadius: 0, pointHoverRadius: 3,
    borderWidth: 2, labelColor: '#eae8e0', ...(stack ? { stack, fill: true } : {})
  });

  const drawTrend = () => {
    const monthsSlice = sliceByRange(months, state.assetTrendRange);
    const mode = state.assetTrendMode;
    if (state.charts.trend) state.charts.trend.destroy();
    const ctx = document.getElementById('chart-trend');
    let datasets = [];
    let legendHtml = '';
    overlayBox.style.display = mode === 'total' ? '' : 'none';

    if (mode === 'total') {
      filterBtns.style.display = 'none';
      datasets = [{ label: '총자산', data: monthsSlice.map(m => d.byMonth[m] || 0), borderColor: '#c9a227', backgroundColor: 'rgba(201,162,39,0.12)', fill: true, tension: 0.35, pointRadius: 2, pointBackgroundColor: '#c9a227', borderWidth: 2, labelColor: '#efdfa0', yAxisID: 'y' }];
      legendHtml = `<span><i style="background:var(--accent-fill)"></i>총자산</span>`;
      if (document.getElementById('asset-net-toggle') && document.getElementById('asset-net-toggle').checked) {
        datasets.push({ type: 'bar', label: '월별 순익', data: monthsSlice.map(m => netByMonth[m] || 0), backgroundColor: monthsSlice.map(m => (netByMonth[m] || 0) >= 0 ? 'rgba(57,168,189,0.6)' : 'rgba(193,72,63,0.55)'), yAxisID: 'y1' });
        legendHtml += `<span><i style="background:var(--net-fill)"></i>월별 순익</span>`;
      }
      if (document.getElementById('asset-cumnet-toggle') && document.getElementById('asset-cumnet-toggle').checked) {
        datasets.push({ type: 'line', label: '누적 순익', data: monthsSlice.map(m => cumNetByMonth[m] || 0), borderColor: '#9b7fc2', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, borderWidth: 2, yAxisID: 'y1' });
        legendHtml += `<span><i style="background:var(--net-fill)"></i>누적 순익</span>`;
      }
    } else if (mode === 'category') {
      const cats = CAT_ORDER.filter(c => series.catTotals[c] > 0);
      filterBtns.style.display = '';
      renderFilterBtns(cats, '전체 카테고리');
      if (state.assetTrendFilter !== 'all' && cats.includes(state.assetTrendFilter)) {
        const cat = state.assetTrendFilter;
        datasets = [lineDs(cat, monthsSlice.map(m => (series.catByMonth[m] && series.catByMonth[m][cat]) || 0), CAT_COLORS[cat] || '#888')];
      } else {
        datasets = cats.map(cat => lineDs(cat, monthsSlice.map(m => (series.catByMonth[m] && series.catByMonth[m][cat]) || 0), CAT_COLORS[cat] || '#888', 's'));
        legendHtml = cats.map(c => `<span><i style="background:${CAT_COLORS[c] || '#888'}"></i>${c}</span>`).join('');
      }
    } else {
      filterBtns.style.display = '';
      renderFilterBtns(series.accounts, '전체 계좌');
      if (state.assetTrendFilter !== 'all' && series.accounts.includes(state.assetTrendFilter)) {
        const acc = state.assetTrendFilter;
        const i = series.accounts.indexOf(acc);
        datasets = [lineDs(acc, monthsSlice.map(m => (series.accByMonth[m] && series.accByMonth[m][acc]) || 0), CAT_PIE_PALETTE_INV[i % CAT_PIE_PALETTE_INV.length])];
      } else {
        datasets = series.accounts.map((acc, i) => lineDs(acc, monthsSlice.map(m => (series.accByMonth[m] && series.accByMonth[m][acc]) || 0), CAT_PIE_PALETTE_INV[i % CAT_PIE_PALETTE_INV.length], 's'));
        legendHtml = series.accounts.map((acc, i) => `<span><i style="background:${CAT_PIE_PALETTE_INV[i % CAT_PIE_PALETTE_INV.length]}"></i>${acc}</span>`).join('');
      }
    }

    const isolated = mode !== 'total' && state.assetTrendFilter !== 'all';
    const stacked = mode !== 'total' && !isolated;
    const hasOverlay = mode === 'total' && datasets.length > 1;

    state.charts.trend = new Chart(ctx, {
      type: 'line',
      data: { labels: monthsSlice.map(assetMonthLabel), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: hasOverlay ? {
          x: { ticks: MONO_TICK, grid: { display: false } },
          y: { position: 'left', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
          y1: { position: 'right', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: { display: false } }
        } : {
          x: { stacked, ticks: MONO_TICK, grid: { display: false } },
          y: { stacked, ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
        }
      },
      plugins: (mode === 'total' || isolated) ? [valueLabelPlugin] : []
    });
    document.getElementById('asset-trend-legend').innerHTML = legendHtml;
  };

  function onAssetTrendRangePick(v) {
    state.assetTrendRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('asset-trend-range-toggle', RANGE_OPTIONS, state.assetTrendRange, onAssetTrendRangePick);
    drawTrend();
  }
  bindRangeToggle('asset-trend-range-toggle', RANGE_OPTIONS, state.assetTrendRange, onAssetTrendRangePick);

  document.getElementById('asset-net-toggle').addEventListener('change', drawTrend);
  document.getElementById('asset-cumnet-toggle').addEventListener('change', drawTrend);

  document.getElementById('asset-trend-mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.assetTrendMode = btn.dataset.mode;
    state.assetTrendFilter = 'all';
    document.querySelectorAll('#asset-trend-mode-toggle button').forEach(b => b.classList.toggle('active', b === btn));
    drawTrend();
  });

  drawTrend();
}
